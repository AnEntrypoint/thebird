#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <uv.h>
#include "tjs.h"

uv_loop_t *TJS_GetLoop(TJSRuntime *qrt);
int tjs_browser_timers_pending(const uv_loop_t *loop);
void tjs_browser_stop_timers(uv_loop_t *loop);
JSValue tjs_browser_http_deliver(JSContext *ctx, const char *text, size_t len);
void tjs_browser_http_release(JSContext *ctx);
void tjs_browser_fs_install(JSContext *ctx);

static TJSRuntime *runtime = NULL;
static JSValue module_promise;
static int has_module = 0;
static volatile int cancel_requested = 0;

#define TJS_BROWSER_WAITING 2
#define TJS_BROWSER_CANCELLED 130

static int report_value(JSContext *ctx, JSValue value) {
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

    if (cancel_requested) {
        tjs_browser_stop_timers(loop);
        return TJS_BROWSER_CANCELLED;
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
    return tjs_browser_timers_pending(loop) ? TJS_BROWSER_WAITING : 0;
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
    TJS_FreeRuntime(runtime);
    runtime = NULL;
}

int tjs_browser_eval(const char *code) {
    tjs_browser_end();
    cancel_requested = 0;
    char *argv[] = {"tjs", NULL};
    TJS_Initialize(1, argv);
    runtime = TJS_NewRuntime();
    if (!runtime) {
        return 1;
    }
    JSContext *ctx = TJS_GetJSContext(runtime);
    tjs_browser_fs_install(ctx);
    int status = 0;

    JSValue result = JS_Eval(ctx, code, strlen(code), "<tjs -e>", JS_EVAL_TYPE_MODULE);
    if (JS_IsException(result)) {
        status = report_exception(ctx);
    } else {
        module_promise = result;
        has_module = 1;
    }

    int pumped = pump(runtime);
    int checked = check_module(ctx);
    return status || pumped || checked;
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
    return status || pumped || checked;
}

void tjs_browser_cancel(void) {
    cancel_requested = 1;
}

int tjs_browser_tick(void) {
    if (!runtime) {
        return 1;
    }
    JSContext *ctx = TJS_GetJSContext(runtime);
    int pumped = pump(runtime);
    int checked = check_module(ctx);
    return pumped || checked;
}
