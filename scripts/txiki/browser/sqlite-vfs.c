#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sqlite3.h>

#define HOST_IMPORT(name) __attribute__((import_module("env"), import_name(name)))

HOST_IMPORT("tjs_fs_open") int32_t host_fs_open(const char *path, int32_t len, int32_t create);
HOST_IMPORT("tjs_fs_close") void host_fs_close(int32_t handle);
HOST_IMPORT("tjs_fs_size") int32_t host_fs_size(int32_t handle);
HOST_IMPORT("tjs_fs_read") int32_t host_fs_read(int32_t handle, void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_write") int32_t host_fs_write(int32_t handle, const void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_truncate") int32_t host_fs_truncate(int32_t handle, int32_t size);
HOST_IMPORT("tjs_fs_access") int32_t host_fs_access(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_delete") int32_t host_fs_delete(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_resolve") int32_t host_fs_resolve(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_random") void host_random(void *buf, int32_t len);
HOST_IMPORT("tjs_now_ms") double host_now_ms(void);

typedef struct thebird_file {
    sqlite3_file base;
    int32_t handle;
    int flags;
    char *name;
} thebird_file;

static const double JULIAN_DAY_MS_EPOCH = 210866760000000.0;
static int temp_counter = 0;

static int tb_close(sqlite3_file *f) {
    thebird_file *file = (thebird_file *) f;
    if (file->handle >= 0) host_fs_close(file->handle);
    file->handle = -1;
    if ((file->flags & SQLITE_OPEN_DELETEONCLOSE) && file->name) {
        host_fs_delete(file->name, (int32_t) strlen(file->name));
    }
    free(file->name);
    file->name = NULL;
    return SQLITE_OK;
}

static int tb_read(sqlite3_file *f, void *buf, int amt, sqlite3_int64 offset) {
    thebird_file *file = (thebird_file *) f;
    int32_t n = host_fs_read(file->handle, buf, amt, (int32_t) offset);
    if (n < 0) return SQLITE_IOERR_READ;
    if (n < amt) {
        memset((char *) buf + n, 0, (size_t) (amt - n));
        return SQLITE_IOERR_SHORT_READ;
    }
    return SQLITE_OK;
}

static int tb_write(sqlite3_file *f, const void *buf, int amt, sqlite3_int64 offset) {
    thebird_file *file = (thebird_file *) f;
    return host_fs_write(file->handle, buf, amt, (int32_t) offset) == amt ? SQLITE_OK : SQLITE_IOERR_WRITE;
}

static int tb_truncate(sqlite3_file *f, sqlite3_int64 size) {
    thebird_file *file = (thebird_file *) f;
    return host_fs_truncate(file->handle, (int32_t) size) == 0 ? SQLITE_OK : SQLITE_IOERR_TRUNCATE;
}

static int tb_sync(sqlite3_file *f, int flags) {
    return SQLITE_OK;
}

static int tb_file_size(sqlite3_file *f, sqlite3_int64 *size) {
    thebird_file *file = (thebird_file *) f;
    int32_t n = host_fs_size(file->handle);
    if (n < 0) return SQLITE_IOERR_FSTAT;
    *size = n;
    return SQLITE_OK;
}

static int tb_lock(sqlite3_file *f, int level) {
    return SQLITE_OK;
}

static int tb_unlock(sqlite3_file *f, int level) {
    return SQLITE_OK;
}

static int tb_check_reserved_lock(sqlite3_file *f, int *out) {
    *out = 0;
    return SQLITE_OK;
}

static int tb_file_control(sqlite3_file *f, int op, void *arg) {
    return SQLITE_NOTFOUND;
}

static int tb_sector_size(sqlite3_file *f) {
    return 4096;
}

static int tb_device_characteristics(sqlite3_file *f) {
    return 0;
}

static const sqlite3_io_methods tb_io_methods = {
    .iVersion = 1,
    .xClose = tb_close,
    .xRead = tb_read,
    .xWrite = tb_write,
    .xTruncate = tb_truncate,
    .xSync = tb_sync,
    .xFileSize = tb_file_size,
    .xLock = tb_lock,
    .xUnlock = tb_unlock,
    .xCheckReservedLock = tb_check_reserved_lock,
    .xFileControl = tb_file_control,
    .xSectorSize = tb_sector_size,
    .xDeviceCharacteristics = tb_device_characteristics,
};

static int tb_open(sqlite3_vfs *vfs, const char *name, sqlite3_file *f, int flags, int *out_flags) {
    thebird_file *file = (thebird_file *) f;
    char temp[64];
    int create = (flags & SQLITE_OPEN_CREATE) ? 1 : 0;
    if (!name) {
        snprintf(temp, sizeof temp, "/.thebird/sqlite-temp-%d", ++temp_counter);
        name = temp;
        create = 1;
    }
    memset(file, 0, sizeof *file);
    file->handle = host_fs_open(name, (int32_t) strlen(name), create);
    if (file->handle < 0) {
        f->pMethods = NULL;
        return SQLITE_CANTOPEN;
    }
    file->flags = flags;
    file->name = strdup(name);
    f->pMethods = &tb_io_methods;
    if (out_flags) *out_flags = flags;
    return SQLITE_OK;
}

static int tb_delete(sqlite3_vfs *vfs, const char *name, int sync_dir) {
    if (host_fs_delete(name, (int32_t) strlen(name)) != 0) return SQLITE_IOERR_DELETE_NOENT;
    return SQLITE_OK;
}

static int tb_access(sqlite3_vfs *vfs, const char *name, int flags, int *out) {
    *out = host_fs_access(name, (int32_t) strlen(name));
    return SQLITE_OK;
}

static int tb_full_pathname(sqlite3_vfs *vfs, const char *name, int out_len, char *out) {
    int32_t n = host_fs_resolve(name, (int32_t) strlen(name), out, out_len);
    if (n < 0) return SQLITE_CANTOPEN;
    out[n] = 0;
    return SQLITE_OK;
}

static int tb_randomness(sqlite3_vfs *vfs, int n, char *out) {
    host_random(out, n);
    return n;
}

static int tb_sleep(sqlite3_vfs *vfs, int microseconds) {
    return 0;
}

static int tb_current_time(sqlite3_vfs *vfs, double *out) {
    *out = JULIAN_DAY_MS_EPOCH / 86400000.0 + host_now_ms() / 86400000.0;
    return SQLITE_OK;
}

static int tb_get_last_error(sqlite3_vfs *vfs, int n, char *out) {
    return 0;
}

static int tb_current_time_int64(sqlite3_vfs *vfs, sqlite3_int64 *out) {
    *out = (sqlite3_int64) JULIAN_DAY_MS_EPOCH + (sqlite3_int64) host_now_ms();
    return SQLITE_OK;
}

static sqlite3_vfs tb_vfs = {
    .iVersion = 3,
    .szOsFile = sizeof(thebird_file),
    .mxPathname = 1024,
    .zName = "thebird",
    .xOpen = tb_open,
    .xDelete = tb_delete,
    .xAccess = tb_access,
    .xFullPathname = tb_full_pathname,
    .xRandomness = tb_randomness,
    .xSleep = tb_sleep,
    .xCurrentTime = tb_current_time,
    .xGetLastError = tb_get_last_error,
    .xCurrentTimeInt64 = tb_current_time_int64,
};

int sqlite3_os_init(void) {
    return sqlite3_vfs_register(&tb_vfs, 1);
}

int sqlite3_os_end(void) {
    return SQLITE_OK;
}

int sqlite3_load_extension(sqlite3 *db, const char *file, const char *proc, char **err) {
    if (err) *err = sqlite3_mprintf("loading extensions is not available in the browser build");
    return SQLITE_ERROR;
}
