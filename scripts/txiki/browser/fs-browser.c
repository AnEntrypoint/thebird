#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <quickjs.h>

#define HOST_IMPORT(name) __attribute__((import_module("env"), import_name(name)))

HOST_IMPORT("tjs_bridge_send") void host_bridge_send(const char *ptr, int32_t len);
HOST_IMPORT("tjs_fs_open") int32_t host_fs_open(const char *path, int32_t len, int32_t create);
HOST_IMPORT("tjs_fs_close") void host_fs_close(int32_t handle);
HOST_IMPORT("tjs_fs_size") int32_t host_fs_size(int32_t handle);
HOST_IMPORT("tjs_fs_read") int32_t host_fs_read(int32_t handle, void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_write") int32_t host_fs_write(int32_t handle, const void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_truncate") int32_t host_fs_truncate(int32_t handle, int32_t size);
HOST_IMPORT("tjs_fs_delete") int32_t host_fs_delete(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_stat") int32_t host_fs_stat(const char *path, int32_t len, double *out);
HOST_IMPORT("tjs_fs_readdir") int32_t host_fs_readdir(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_fs_mkdir") int32_t host_fs_mkdir(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_rmdir") int32_t host_fs_rmdir(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_symlink") int32_t host_fs_symlink(const char *target, int32_t target_len, const char *path, int32_t len);
HOST_IMPORT("tjs_fs_readlink") int32_t host_fs_readlink(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_fs_lstat") int32_t host_fs_lstat(const char *path, int32_t len, double *out);

static JSValue stat_object(JSContext *ctx, int32_t status, const double *slots) {
    if (status != 0) {
        return JS_NULL;
    }
    JSValue info = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, info, "kind", JS_NewFloat64(ctx, slots[0]));
    JS_SetPropertyStr(ctx, info, "size", JS_NewFloat64(ctx, slots[1]));
    JS_SetPropertyStr(ctx, info, "mtimeMs", JS_NewFloat64(ctx, slots[2]));
    JS_SetPropertyStr(ctx, info, "mode", JS_NewFloat64(ctx, slots[3]));
    return info;
}

static JSValue fs_stat(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    double slots[7] = {0, 0, 0, 0, 0, 0, 0};
    int32_t status = host_fs_stat(path, (int32_t) len, slots);
    JS_FreeCString(ctx, path);
    return stat_object(ctx, status, slots);
}

static JSValue fs_lstat(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    double slots[7] = {0, 0, 0, 0, 0, 0, 0};
    int32_t status = host_fs_lstat(path, (int32_t) len, slots);
    JS_FreeCString(ctx, path);
    return stat_object(ctx, status, slots);
}

static JSValue fs_symlink(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t target_len = 0;
    const char *target = JS_ToCStringLen(ctx, &target_len, argv[0]);
    if (!target) {
        return JS_EXCEPTION;
    }
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[1]);
    if (!path) {
        JS_FreeCString(ctx, target);
        return JS_EXCEPTION;
    }
    int32_t status = host_fs_symlink(target, (int32_t) target_len, path, (int32_t) len);
    JS_FreeCString(ctx, target);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, status == 0);
}

static JSValue fs_readlink(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    size_t cap = 1024;
    char *buffer = malloc(cap);
    int32_t total = -1;
    while (buffer) {
        total = host_fs_readlink(path, (int32_t) len, buffer, (int32_t) cap);
        if (total < 0 || total <= (int32_t) cap) {
            break;
        }
        cap = (size_t) total;
        char *grown = realloc(buffer, cap);
        if (!grown) {
            free(buffer);
            buffer = NULL;
        } else {
            buffer = grown;
        }
    }
    JS_FreeCString(ctx, path);
    if (!buffer) {
        return JS_ThrowOutOfMemory(ctx);
    }
    if (total < 0) {
        free(buffer);
        return JS_UNDEFINED;
    }
    JSValue target = JS_NewStringLen(ctx, buffer, (size_t) total);
    free(buffer);
    return target;
}

static JSValue fs_read_file(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    int32_t handle = host_fs_open(path, (int32_t) len, 0);
    JS_FreeCString(ctx, path);
    if (handle < 0) {
        return JS_UNDEFINED;
    }
    int32_t size = host_fs_size(handle);
    if (size < 0) {
        host_fs_close(handle);
        return JS_ThrowInternalError(ctx, "file size is unavailable");
    }
    uint8_t *buffer = malloc(size > 0 ? (size_t) size : 1);
    if (!buffer) {
        host_fs_close(handle);
        return JS_ThrowOutOfMemory(ctx);
    }
    int32_t got = size > 0 ? host_fs_read(handle, buffer, size, 0) : 0;
    host_fs_close(handle);
    if (got < 0) {
        free(buffer);
        return JS_ThrowInternalError(ctx, "file read failed");
    }
    JSValue bytes = JS_NewArrayBufferCopy(ctx, buffer, (size_t) got);
    free(buffer);
    return bytes;
}

static JSValue fs_write_file(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    size_t size = 0;
    uint8_t *data = JS_GetArrayBuffer(ctx, &size, argv[1]);
    if (!data && size) {
        JS_FreeCString(ctx, path);
        return JS_EXCEPTION;
    }
    int32_t handle = host_fs_open(path, (int32_t) len, 1);
    JS_FreeCString(ctx, path);
    if (handle < 0) {
        return JS_FALSE;
    }
    int ok = host_fs_truncate(handle, 0) == 0
        && (size == 0 || host_fs_write(handle, data, (int32_t) size, 0) == (int32_t) size);
    host_fs_close(handle);
    return JS_NewBool(ctx, ok);
}

static JSValue fs_readdir(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!path) {
        return JS_EXCEPTION;
    }
    size_t cap = 4096;
    char *buffer = malloc(cap);
    int32_t total = -1;
    while (buffer) {
        total = host_fs_readdir(path, (int32_t) len, buffer, (int32_t) cap);
        if (total <= (int32_t) cap) {
            break;
        }
        cap = (size_t) total;
        char *grown = realloc(buffer, cap);
        if (!grown) {
            free(buffer);
            buffer = NULL;
        } else {
            buffer = grown;
        }
    }
    JS_FreeCString(ctx, path);
    if (!buffer) {
        return JS_ThrowOutOfMemory(ctx);
    }
    if (total < 0) {
        free(buffer);
        return JS_UNDEFINED;
    }
    JSValue names = JS_NewArray(ctx);
    uint32_t index = 0;
    size_t start = 0;
    for (size_t i = 0; i < (size_t) total; i++) {
        if (buffer[i] == '\0') {
            JS_SetPropertyUint32(ctx, names, index++, JS_NewStringLen(ctx, buffer + start, i - start));
            start = i + 1;
        }
    }
    free(buffer);
    return names;
}

static JSValue path_status(JSContext *ctx, JSValue value, int32_t (*operation)(const char *, int32_t)) {
    size_t len = 0;
    const char *path = JS_ToCStringLen(ctx, &len, value);
    if (!path) {
        return JS_EXCEPTION;
    }
    int32_t status = operation(path, (int32_t) len);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, status == 0);
}

static JSValue fs_unlink(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    return path_status(ctx, argv[0], host_fs_delete);
}

static JSValue fs_mkdir(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    return path_status(ctx, argv[0], host_fs_mkdir);
}

static JSValue fs_rmdir(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    return path_status(ctx, argv[0], host_fs_rmdir);
}

static void define_function(JSContext *ctx, JSValue target, const char *name, JSCFunction *function, int length) {
    JS_DefinePropertyValueStr(ctx, target, name, JS_NewCFunction(ctx, function, name, length), JS_PROP_C_W_E);
}

void tjs_browser_fs_install(JSContext *ctx) {
    JSValue native = JS_NewObject(ctx);
    define_function(ctx, native, "stat", fs_stat, 1);
    define_function(ctx, native, "readFile", fs_read_file, 1);
    define_function(ctx, native, "writeFile", fs_write_file, 2);
    define_function(ctx, native, "readdir", fs_readdir, 1);
    define_function(ctx, native, "unlink", fs_unlink, 1);
    define_function(ctx, native, "mkdir", fs_mkdir, 1);
    define_function(ctx, native, "rmdir", fs_rmdir, 1);
    define_function(ctx, native, "lstat", fs_lstat, 1);
    define_function(ctx, native, "symlink", fs_symlink, 2);
    define_function(ctx, native, "readlink", fs_readlink, 1);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_DefinePropertyValueStr(ctx, global, "__thebirdFs", native, JS_PROP_C_W_E);
    JS_FreeValue(ctx, global);
}

static JSValue bridge_send(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    size_t len = 0;
    const char *text = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!text) {
        return JS_EXCEPTION;
    }
    host_bridge_send(text, (int32_t) len);
    JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}

void tjs_browser_bridge_install(JSContext *ctx) {
    JSValue bridge = JS_NewObject(ctx);
    define_function(ctx, bridge, "send", bridge_send, 1);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_DefinePropertyValueStr(ctx, global, "__thebirdBridge", bridge, JS_PROP_C_W_E);
    JS_FreeValue(ctx, global);
}
