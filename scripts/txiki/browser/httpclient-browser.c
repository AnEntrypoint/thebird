#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "tjs.h"
#include "http-client-bootstrap.h"

__attribute__((import_module("env"), import_name("tjs_bridge_send"))) void host_bridge_send(const char *ptr, int32_t len);

static JSValue deliver_fn;
static int has_deliver = 0;

static JSValue js_bridge_send(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *text = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!text) {
        return JS_EXCEPTION;
    }
    host_bridge_send(text, (int32_t) len);
    JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}

void tjs__mod_httpclient_init(JSContext *ctx, JSValue ns) {
    JSValue factory = JS_Eval(ctx, http_client_bootstrap, strlen(http_client_bootstrap), "<http-client>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(factory)) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return;
    }
    JSValue bridge = JS_NewCFunction(ctx, js_bridge_send, "send", 1);
    JSValue api = JS_Call(ctx, factory, JS_UNDEFINED, 1, &bridge);
    JS_FreeValue(ctx, factory);
    JS_FreeValue(ctx, bridge);
    if (JS_IsException(api)) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return;
    }
    JS_SetPropertyStr(ctx, ns, "HttpClient", JS_GetPropertyStr(ctx, api, "HttpClient"));
    deliver_fn = JS_GetPropertyStr(ctx, api, "deliver");
    has_deliver = 1;
    JS_FreeValue(ctx, api);
}

JSValue tjs_browser_http_deliver(JSContext *ctx, const char *text, size_t len) {
    JSValue message = JS_NewStringLen(ctx, text, len);
    JSValue result = JS_Call(ctx, deliver_fn, JS_UNDEFINED, 1, &message);
    JS_FreeValue(ctx, message);
    return result;
}

void tjs_browser_http_release(JSContext *ctx) {
    if (has_deliver) {
        JS_FreeValue(ctx, deliver_fn);
        has_deliver = 0;
    }
}
