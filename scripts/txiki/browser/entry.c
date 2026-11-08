#include <stdio.h>
#include <string.h>
#include <uv.h>
#include "tjs.h"

uv_loop_t *TJS_GetLoop(TJSRuntime *qrt);
int tjs_browser_timers_pending(const uv_loop_t *loop);

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

int tjs_browser_eval(const char *code) {
    char *argv[] = {"tjs", NULL};
    TJS_Initialize(1, argv);
    TJSRuntime *qrt = TJS_NewRuntime();
    if (!qrt) return 1;
    JSContext *ctx = TJS_GetJSContext(qrt);
    JSRuntime *rt = JS_GetRuntime(ctx);
    uv_loop_t *loop = TJS_GetLoop(qrt);
    int status = 0;

    JSValue result = JS_Eval(ctx, code, strlen(code), "<tjs -e>", JS_EVAL_TYPE_MODULE);
    if (JS_IsException(result)) {
        status = report_exception(ctx);
    } else {
        if (JS_PromiseState(ctx, result) == JS_PROMISE_REJECTED) {
            status = report_value(ctx, JS_PromiseResult(ctx, result));
        }
        JS_FreeValue(ctx, result);
    }

    do {
        uv_run(loop, UV_RUN_DEFAULT);
        JSContext *job_ctx;
        int job;
        while ((job = JS_ExecutePendingJob(rt, &job_ctx)) != 0) {
            if (job < 0) status = report_exception(job_ctx);
        }
    } while (JS_IsJobPending(rt) || tjs_browser_timers_pending(loop));

    TJS_FreeRuntime(qrt);
    return status;
}
