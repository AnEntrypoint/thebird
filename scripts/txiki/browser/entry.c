#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "private.h"

int tjs_browser_work_pending(const uv_loop_t *loop);
void tjs_browser_flush_writes(uv_loop_t *loop);
void tjs_browser_stop_timers(uv_loop_t *loop);
JSValue tjs_browser_http_deliver(JSContext *ctx, const char *text, size_t len);
void tjs_browser_http_release(JSContext *ctx);
void tjs_browser_fs_install(JSContext *ctx);
void tjs_browser_bridge_install(JSContext *ctx);

static TJSRuntime *runtime = NULL;
static JSValue module_promise;
static int has_module = 0;
static volatile int cancel_requested = 0;
static double deadline_ms = 0;
static int stop_status = 0;
static uv_loop_t *current_loop = NULL;

#define HOST_IMPORT(name) __attribute__((import_module("env"), import_name(name)))
HOST_IMPORT("tjs_now_ms") double host_now_ms(void);
HOST_IMPORT("tjs_cancel_requested") int32_t host_cancel_requested(void);

#define TJS_BROWSER_WAITING 2
#define TJS_BROWSER_TIMED_OUT 124
#define TJS_BROWSER_CANCELLED 130

static int interrupted(JSContext *ctx, void *opaque) {
    if (stop_status) {
        return 1;
    }
    if (cancel_requested || host_cancel_requested()) {
        stop_status = TJS_BROWSER_CANCELLED;
        return 1;
    }
    if (deadline_ms > 0 && host_now_ms() > deadline_ms) {
        stop_status = TJS_BROWSER_TIMED_OUT;
        return 1;
    }
    return 0;
}

static int report_value(JSContext *ctx, JSValue value) {
    if (stop_status) {
        JS_FreeValue(ctx, value);
        return stop_status;
    }
    const char *message = JS_ToCString(ctx, value);
    fprintf(stderr, "Uncaught %s\n", message ? message : "exception");
    JS_FreeCString(ctx, message);
    JS_FreeValue(ctx, value);
    return 1;
}

static int report_exception(JSContext *ctx) {
    return report_value(ctx, JS_GetException(ctx));
}

static int drain_jobs(JSRuntime *rt) {
    int status = 0;
    JSContext *job_ctx;
    int job;
    while ((job = JS_ExecutePendingJob(rt, &job_ctx)) != 0) {
        if (job < 0) {
            status = report_exception(job_ctx);
        }
    }
    return status;
}

static int pump(TJSRuntime *qrt) {
    JSContext *ctx = TJS_GetJSContext(qrt);
    JSRuntime *rt = JS_GetRuntime(ctx);
    uv_loop_t *loop = TJS_GetLoop(qrt);

    if (!stop_status && (cancel_requested || host_cancel_requested())) {
        stop_status = TJS_BROWSER_CANCELLED;
    }
    if (!stop_status && deadline_ms > 0 && host_now_ms() > deadline_ms) {
        stop_status = TJS_BROWSER_TIMED_OUT;
    }
    if (stop_status) {
        tjs_browser_stop_timers(loop);
        return stop_status;
    }
    int status = drain_jobs(rt);
    if (status) {
        return status;
    }
    uv_run(loop, UV_RUN_NOWAIT);
    status = drain_jobs(rt);
    if (status) {
        return status;
    }
    return tjs_browser_work_pending(loop) ? TJS_BROWSER_WAITING : 0;
}

static int first_set(int first, int second, int third) {
    if (first) return first;
    if (second) return second;
    return third;
}

static int check_module(JSContext *ctx) {
    if (!has_module) {
        return 0;
    }
    int state = JS_PromiseState(ctx, module_promise);
    if (state == JS_PROMISE_PENDING) {
        return 0;
    }
    int status = 0;
    if (state == JS_PROMISE_REJECTED) {
        status = report_value(ctx, JS_PromiseResult(ctx, module_promise));
    }
    JS_FreeValue(ctx, module_promise);
    has_module = 0;
    return status;
}

void tjs_fs_release_loop(uv_loop_t *loop);

void tjs_browser_end(void) {
    if (!runtime) {
        return;
    }
    JSContext *ctx = TJS_GetJSContext(runtime);
    tjs_browser_http_release(ctx);
    if (has_module) {
        JS_FreeValue(ctx, module_promise);
        has_module = 0;
    }
    tjs_fs_release_loop(TJS_GetLoop(runtime));
    TJS_FreeRuntime(runtime);
    runtime = NULL;
}

void tjs_browser_set_deadline(double ms) {
    deadline_ms = ms;
}

static int engine_ready = 0;

static void ensure_initialized(void) {
    if (engine_ready) {
        return;
    }
    char *argv[] = {"tjs", NULL};
    TJS_Initialize(1, argv);
    engine_ready = 1;
}

int tjs_browser_eval(const char *code, const char *name) {
    tjs_browser_end();
    cancel_requested = 0;
    stop_status = 0;
    ensure_initialized();
    runtime = TJS_NewRuntime();
    if (!runtime) {
        return 1;
    }
    current_loop = TJS_GetLoop(runtime);
    JSContext *ctx = TJS_GetJSContext(runtime);
    JS_SetInterruptHandler(JS_GetRuntime(ctx), interrupted, NULL);
    tjs_browser_fs_install(ctx);
    tjs_browser_bridge_install(ctx);
    int status = 0;

    JSValue result = JS_Eval(ctx, code, strlen(code), name, JS_EVAL_TYPE_MODULE);
    if (JS_IsException(result)) {
        status = report_exception(ctx);
    } else {
        module_promise = result;
        has_module = 1;
    }

    int pumped = pump(runtime);
    int checked = check_module(ctx);
    return first_set(status, pumped, checked);
}

int tjs_browser_resume(const char *text, int32_t len) {
    if (!runtime) {
        return 1;
    }
    JSContext *ctx = TJS_GetJSContext(runtime);
    int status = 0;

    JSValue result = tjs_browser_http_deliver(ctx, text, (size_t) len);
    if (JS_IsException(result)) {
        status = report_exception(ctx);
    } else {
        JS_FreeValue(ctx, result);
    }

    int pumped = pump(runtime);
    int checked = check_module(ctx);
    return first_set(status, pumped, checked);
}

void tjs_browser_cancel(void) {
    cancel_requested = 1;
}

void tjs_browser_exit(int status) {
    if (current_loop) {
        tjs_browser_flush_writes(current_loop);
    }
    exit(status);
}

int tjs_browser_tick(void) {
    if (!runtime) {
        return 1;
    }
    JSContext *ctx = TJS_GetJSContext(runtime);
    int pumped = pump(runtime);
    int checked = check_module(ctx);
    return first_set(pumped, checked, 0);
}
