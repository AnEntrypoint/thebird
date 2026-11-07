#include <stdlib.h>
#include <string.h>

#include "quickjs.h"

JSContext *qjs_get_context(void);

static char *last_result;

static char *owned_string(const char *prefix, const char *text)
{
    size_t prefix_length = strlen(prefix);
    size_t text_length = strlen(text);
    char *out = malloc(prefix_length + text_length + 1);

    if (out) {
        memcpy(out, prefix, prefix_length);
        memcpy(out + prefix_length, text, text_length + 1);
    }
    return out;
}

static char *value_text(JSContext *ctx, JSValue value, const char *prefix)
{
    const char *text = JS_ToCString(ctx, value);
    char *out;

    if (!text)
        return owned_string(prefix, "<unprintable>");
    out = owned_string(prefix, text);
    JS_FreeCString(ctx, text);
    return out;
}

__attribute__((export_name("thebird_eval")))
const char *thebird_eval(const char *source, size_t length)
{
    JSContext *ctx = qjs_get_context();
    char *terminated = malloc(length + 1);
    JSValue value;

    free(last_result);
    last_result = NULL;
    if (!terminated)
        return NULL;
    memcpy(terminated, source, length);
    terminated[length] = '\0';
    value = JS_Eval(ctx, terminated, length, "<thebird>", JS_EVAL_TYPE_GLOBAL);
    free(terminated);
    if (JS_IsException(value)) {
        JSValue exception = JS_GetException(ctx);

        last_result = value_text(ctx, exception, "Uncaught ");
        JS_FreeValue(ctx, exception);
    } else {
        last_result = value_text(ctx, value, "");
    }
    JS_FreeValue(ctx, value);
    return last_result;
}
