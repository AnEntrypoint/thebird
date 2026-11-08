#include <stddef.h>
#include <quickjs.h>

static const char *const webcrypto_names[] = {
    "aesKw", "cipher", "digest", "ecdhDeriveBits", "ecdsaSign", "ecdsaVerify",
    "ecGenerateKey", "ecGetPublicKey", "ecKeyToDer", "ecParseKey",
    "ed25519GenerateKey", "ed25519GetPublicKey", "ed25519Sign", "ed25519Verify",
    "hkdf", "hmacSign", "pbkdf2", "rsaExportJwk", "rsaGenerateKey", "rsaImportJwk",
    "rsaOaepDecrypt", "rsaOaepEncrypt", "rsaParseKey", "rsaSign", "rsaVerify",
    "x25519DeriveBits", "x25519GenerateKey", "x25519GetPublicKey",
};

static JSValue webcrypto_unavailable(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    return JS_ThrowTypeError(ctx, "webcrypto is not available in the browser build");
}

void tjs__webcrypto_init(JSContext *ctx, JSValue ns) {
    JSValue obj = JS_NewObject(ctx);
    for (size_t i = 0; i < sizeof webcrypto_names / sizeof webcrypto_names[0]; i++) {
        JSValue fn = JS_NewCFunction(ctx, webcrypto_unavailable, webcrypto_names[i], 0);
        JS_DefinePropertyValueStr(ctx, obj, webcrypto_names[i], fn, JS_PROP_C_W_E);
    }
    JS_DefinePropertyValueStr(ctx, ns, "webcrypto", obj, JS_PROP_C_W_E);
}
