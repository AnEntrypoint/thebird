#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
#include <time.h>

#include <uv.h>

#define HOST_IMPORT(name) __attribute__((import_module("env"), import_name(name)))

HOST_IMPORT("tjs_fs_open") int32_t host_fs_open(const char *path, int32_t len, int32_t create);
HOST_IMPORT("tjs_fs_close") void host_fs_close(int32_t handle);
HOST_IMPORT("tjs_fs_truncate") int32_t host_fs_truncate(int32_t handle, int32_t size);
HOST_IMPORT("tjs_fs_read") int32_t host_fs_read(int32_t handle, void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_write") int32_t host_fs_write(int32_t handle, const void *buf, int32_t len, int32_t offset);
HOST_IMPORT("tjs_fs_access") int32_t host_fs_access(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_delete") int32_t host_fs_delete(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_stat") int32_t host_fs_stat(const char *path, int32_t len, double *out);
HOST_IMPORT("tjs_fs_lstat") int32_t host_fs_lstat(const char *path, int32_t len, double *out);
HOST_IMPORT("tjs_fs_mkdir") int32_t host_fs_mkdir(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_rmdir") int32_t host_fs_rmdir(const char *path, int32_t len);
HOST_IMPORT("tjs_fs_symlink") int32_t host_fs_symlink(const char *target, int32_t target_len, const char *path, int32_t len);
HOST_IMPORT("tjs_fs_readlink") int32_t host_fs_readlink(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_fs_readdir") int32_t host_fs_readdir(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_fs_realpath") int32_t host_fs_realpath(const char *path, int32_t len, char *out, int32_t cap);
HOST_IMPORT("tjs_fs_rename") int32_t host_fs_rename(const char *from, int32_t from_len, const char *to, int32_t to_len);
HOST_IMPORT("tjs_fs_link") int32_t host_fs_link(const char *from, int32_t from_len, const char *to, int32_t to_len);
HOST_IMPORT("tjs_fs_quota") int32_t host_fs_quota(double *out);
HOST_IMPORT("tjs_fs_flush") int32_t host_fs_flush(int32_t id);
HOST_IMPORT("tjs_fs_setattr") int32_t host_fs_setattr(const char *path, int32_t len, int32_t follow, int32_t attr, double value);
HOST_IMPORT("tjs_fs_resolve") int32_t host_fs_resolve(const char *path, int32_t len, char *out, int32_t cap);

void tjs_browser_defer(uv_loop_t *loop, void (*fn)(void *arg), void *arg);

struct fd_position {
    int32_t fd;
    int64_t pos;
    char *path;
    struct fd_position *next;
};

static struct fd_position *positions;

static void position_set(int32_t fd, char *path) {
    for (struct fd_position *p = positions; p; p = p->next) {
        if (p->fd == fd) {
            free(p->path);
            p->pos = 0;
            p->path = path;
            return;
        }
    }
    struct fd_position *p = malloc(sizeof(*p));
    if (!p) {
        free(path);
        return;
    }
    p->fd = fd;
    p->pos = 0;
    p->path = path;
    p->next = positions;
    positions = p;
}

static struct fd_position *position_find(int32_t fd) {
    for (struct fd_position *p = positions; p; p = p->next) {
        if (p->fd == fd) return p;
    }
    return NULL;
}

static void position_remove(int32_t fd) {
    for (struct fd_position **link = &positions; *link; link = &(*link)->next) {
        if ((*link)->fd == fd) {
            struct fd_position *dead = *link;
            *link = dead->next;
            free(dead->path);
            free(dead);
            return;
        }
    }
}

static void fs_done(void *arg) {
    uv_fs_t *req = arg;
    if (req->cb) req->cb(req);
}

static int fs_finish(uv_fs_t *req, uv_loop_t *loop, uv_fs_cb cb, int64_t result) {
    req->loop = loop;
    req->cb = cb;
    req->result = (ssize_t) result;
    if (!cb) return (int) result;
    tjs_browser_defer(loop, fs_done, req);
    return 0;
}

static int64_t stat_into(uv_fs_t *req, int32_t status, const double *slots) {
    if (status != 0) return UV_ENOENT;
    req->statbuf.st_mode = (uint64_t) slots[3];
    req->statbuf.st_nlink = slots[7] > 0 ? (uint64_t) slots[7] : 1;
    req->statbuf.st_size = (uint64_t) slots[1];
    req->statbuf.st_mtim.tv_sec = (long) (slots[2] / 1000);
    req->statbuf.st_mtim.tv_nsec = (long) ((int64_t) slots[2] % 1000) * 1000000;
    req->statbuf.st_uid = (uint64_t) slots[4];
    req->statbuf.st_gid = (uint64_t) slots[5];
    req->statbuf.st_atim.tv_sec = (long) (slots[6] / 1000);
    req->statbuf.st_atim.tv_nsec = (long) ((int64_t) slots[6] % 1000) * 1000000;
    return 0;
}

static char *grow_buffer(char *buffer, size_t cap) {
    char *grown = realloc(buffer, cap);
    if (!grown) free(buffer);
    return grown;
}

static char *absolute_path(const char *path) {
    int32_t len = (int32_t) strlen(path);
    size_t cap = 1024;
    char *buffer = malloc(cap);
    if (!buffer) return NULL;
    int32_t total = host_fs_resolve(path, len, buffer, (int32_t) cap);
    while (total < 0 && cap < 65536) {
        cap *= 2;
        buffer = grow_buffer(buffer, cap);
        if (!buffer) return NULL;
        total = host_fs_resolve(path, len, buffer, (int32_t) cap);
    }
    if (total < 0) {
        free(buffer);
        return NULL;
    }
    buffer[total] = '\0';
    return buffer;
}

int uv_fs_open(uv_loop_t *loop, uv_fs_t *req, const char *path, int flags, int mode, uv_fs_cb cb) {
    (void) mode;
    req->fs_type = UV_FS_OPEN;
    req->path = path;
    req->ptr = NULL;
    int64_t result = UV_ENOENT;
    char *resolved = absolute_path(path);
    if (resolved) {
        int32_t handle = host_fs_open(path, (int32_t) strlen(path), (flags & O_CREAT) != 0);
        if (handle >= 0) {
            position_set(handle, resolved);
            result = handle;
        } else {
            free(resolved);
        }
    } else {
        result = UV_ENAMETOOLONG;
    }
    return fs_finish(req, loop, cb, result);
}

int uv_fs_fstat(uv_loop_t *loop, uv_fs_t *req, uv_file file, uv_fs_cb cb) {
    req->fs_type = UV_FS_FSTAT;
    req->ptr = NULL;
    struct fd_position *slot = position_find(file);
    if (!slot) return fs_finish(req, loop, cb, UV_EBADF);
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int64_t result = stat_into(req, host_fs_stat(slot->path, (int32_t) strlen(slot->path), slots), slots);
    return fs_finish(req, loop, cb, result);
}

int uv_fs_close(uv_loop_t *loop, uv_fs_t *req, uv_file file, uv_fs_cb cb) {
    req->fs_type = UV_FS_CLOSE;
    req->ptr = NULL;
    int64_t result = 0;
    if (!position_find(file)) {
        result = UV_EBADF;
    } else {
        position_remove(file);
        host_fs_close(file);
    }
    return fs_finish(req, loop, cb, result);
}

int uv_fs_read(uv_loop_t *loop, uv_fs_t *req, uv_file file, const uv_buf_t bufs[], unsigned int nbufs, int64_t offset, uv_fs_cb cb) {
    req->fs_type = UV_FS_READ;
    req->ptr = NULL;
    struct fd_position *slot = position_find(file);
    if (offset < 0 && !slot) return fs_finish(req, loop, cb, UV_EBADF);
    int64_t cursor = offset >= 0 ? offset : slot->pos;
    int64_t total = 0;
    int64_t result = 0;
    for (unsigned int i = 0; i < nbufs; i++) {
        int32_t got = host_fs_read(file, bufs[i].base, (int32_t) bufs[i].len, (int32_t) cursor);
        if (got < 0) {
            result = total > 0 ? total : UV_EBADF;
            goto done;
        }
        total += got;
        cursor += got;
        if ((size_t) got < bufs[i].len) break;
    }
    result = total;
done:
    if (offset < 0 && result >= 0) slot->pos = cursor;
    return fs_finish(req, loop, cb, result);
}

int uv_fs_write(uv_loop_t *loop, uv_fs_t *req, uv_file file, const uv_buf_t bufs[], unsigned int nbufs, int64_t offset, uv_fs_cb cb) {
    req->fs_type = UV_FS_WRITE;
    req->ptr = NULL;
    struct fd_position *slot = position_find(file);
    if (offset < 0 && !slot) return fs_finish(req, loop, cb, UV_EBADF);
    int64_t cursor = offset >= 0 ? offset : slot->pos;
    int64_t total = 0;
    int64_t result = 0;
    for (unsigned int i = 0; i < nbufs; i++) {
        int32_t put = host_fs_write(file, bufs[i].base, (int32_t) bufs[i].len, (int32_t) cursor);
        if (put < 0) {
            result = total > 0 ? total : UV_EIO;
            goto done;
        }
        total += put;
        cursor += put;
        if ((size_t) put < bufs[i].len) break;
    }
    result = total;
done:
    if (offset < 0 && result >= 0) slot->pos = cursor;
    return fs_finish(req, loop, cb, result);
}

int uv_fs_stat(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_STAT;
    req->path = path;
    req->ptr = NULL;
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int64_t result = stat_into(req, host_fs_stat(path, (int32_t) strlen(path), slots), slots);
    return fs_finish(req, loop, cb, result);
}

int uv_fs_lstat(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_LSTAT;
    req->path = path;
    req->ptr = NULL;
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int64_t result = stat_into(req, host_fs_lstat(path, (int32_t) strlen(path), slots), slots);
    return fs_finish(req, loop, cb, result);
}

int uv_fs_mkdir(uv_loop_t *loop, uv_fs_t *req, const char *path, int mode, uv_fs_cb cb) {
    (void) mode;
    req->fs_type = UV_FS_MKDIR;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(path);
    int64_t result = 0;
    if (host_fs_mkdir(path, len) != 0) result = host_fs_access(path, len) ? UV_EEXIST : UV_ENOENT;
    return fs_finish(req, loop, cb, result);
}

int uv_fs_rmdir(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_RMDIR;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(path);
    int64_t result = 0;
    if (host_fs_rmdir(path, len) != 0) result = host_fs_access(path, len) ? UV_EIO : UV_ENOENT;
    return fs_finish(req, loop, cb, result);
}

int uv_fs_unlink(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_UNLINK;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(path);
    int64_t result = 0;
    if (host_fs_delete(path, len) != 0) result = host_fs_access(path, len) ? UV_EIO : UV_ENOENT;
    return fs_finish(req, loop, cb, result);
}

int uv_fs_symlink(uv_loop_t *loop, uv_fs_t *req, const char *path, const char *new_path, int flags, uv_fs_cb cb) {
    (void) flags;
    req->fs_type = UV_FS_SYMLINK;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(new_path);
    int64_t result = 0;
    if (host_fs_symlink(path, (int32_t) strlen(path), new_path, len) != 0) {
        result = host_fs_access(new_path, len) ? UV_EEXIST : UV_ENOENT;
    }
    return fs_finish(req, loop, cb, result);
}

int uv_fs_readlink(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_READLINK;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(path);
    size_t cap = 256;
    char *buffer = malloc(cap);
    if (!buffer) return fs_finish(req, loop, cb, UV_ENOMEM);
    int32_t total = host_fs_readlink(path, len, buffer, (int32_t) cap);
    while (total >= (int32_t) cap) {
        cap = (size_t) total + 1;
        buffer = grow_buffer(buffer, cap);
        if (!buffer) return fs_finish(req, loop, cb, UV_ENOMEM);
        total = host_fs_readlink(path, len, buffer, (int32_t) cap);
    }
    if (total < 0) {
        free(buffer);
        return fs_finish(req, loop, cb, UV_ENOENT);
    }
    buffer[total] = '\0';
    req->ptr = buffer;
    return fs_finish(req, loop, cb, 0);
}

int uv_fs_realpath(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_REALPATH;
    req->path = path;
    req->ptr = NULL;
    int32_t len = (int32_t) strlen(path);
    size_t cap = 1024;
    char *buffer = malloc(cap);
    if (!buffer) return fs_finish(req, loop, cb, UV_ENOMEM);
    int32_t total = host_fs_realpath(path, len, buffer, (int32_t) cap);
    while (total >= (int32_t) cap) {
        cap = (size_t) total + 1;
        buffer = grow_buffer(buffer, cap);
        if (!buffer) return fs_finish(req, loop, cb, UV_ENOMEM);
        total = host_fs_realpath(path, len, buffer, (int32_t) cap);
    }
    if (total < 0) {
        free(buffer);
        return fs_finish(req, loop, cb, UV_ENOENT);
    }
    buffer[total] = '\0';
    req->ptr = buffer;
    return fs_finish(req, loop, cb, 0);
}

int uv_fs_rename(uv_loop_t *loop, uv_fs_t *req, const char *path, const char *new_path, uv_fs_cb cb) {
    req->fs_type = UV_FS_RENAME;
    req->path = path;
    req->ptr = NULL;
    int64_t result = 0;
    if (host_fs_rename(path, (int32_t) strlen(path), new_path, (int32_t) strlen(new_path)) != 0) {
        result = host_fs_access(path, (int32_t) strlen(path)) ? UV_EIO : UV_ENOENT;
    }
    return fs_finish(req, loop, cb, result);
}

#define COPY_CHUNK 65536
#define TEMP_ATTEMPTS 64

static const char TEMP_ALPHABET[] = "abcdefghijklmnopqrstuvwxyz0123456789";
static uint64_t temp_counter;

static int64_t copy_file(const char *path, const char *new_path, int flags) {
    int32_t path_len = (int32_t) strlen(path);
    int32_t new_len = (int32_t) strlen(new_path);
    int32_t src = host_fs_open(path, path_len, 0);
    if (src < 0) return host_fs_access(path, path_len) ? UV_EISDIR : UV_ENOENT;
    if ((flags & UV_FS_COPYFILE_EXCL) && host_fs_access(new_path, new_len)) {
        host_fs_close(src);
        return UV_EEXIST;
    }
    int32_t dst = host_fs_open(new_path, new_len, 1);
    if (dst < 0) {
        host_fs_close(src);
        return UV_ENOENT;
    }
    int64_t result = 0;
    char *chunk = malloc(COPY_CHUNK);
    if (!chunk || host_fs_truncate(dst, 0) != 0) {
        result = UV_EIO;
    } else {
        int32_t offset = 0;
        for (;;) {
            int32_t got = host_fs_read(src, chunk, COPY_CHUNK, offset);
            if (got < 0) {
                result = UV_EIO;
                break;
            }
            if (got == 0) break;
            if (host_fs_write(dst, chunk, got, offset) != got) {
                result = UV_EIO;
                break;
            }
            offset += got;
        }
    }
    free(chunk);
    host_fs_close(src);
    host_fs_close(dst);
    return result;
}

int uv_fs_copyfile(uv_loop_t *loop, uv_fs_t *req, const char *path, const char *new_path, int flags, uv_fs_cb cb) {
    req->fs_type = UV_FS_COPYFILE;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, copy_file(path, new_path, flags));
}

static char *temp_template(const char *tpl) {
    size_t len = strlen(tpl);
    if (len < 6 || strcmp(tpl + len - 6, "XXXXXX") != 0) return NULL;
    char *name = malloc(len + 1);
    if (name) memcpy(name, tpl, len + 1);
    return name;
}

static void temp_fill(char *name) {
    size_t len = strlen(name);
    uint64_t value = ++temp_counter * 2654435761ULL;
    for (size_t i = 0; i < 6; i++) {
        name[len - 6 + i] = TEMP_ALPHABET[value % 36];
        value /= 36;
    }
}

static int64_t make_temp(uv_fs_t *req, const char *tpl, int directory) {
    char *name = temp_template(tpl);
    if (!name) return UV_EINVAL;
    int64_t failure = UV_EEXIST;
    for (int attempt = 0; attempt < TEMP_ATTEMPTS; attempt++) {
        temp_fill(name);
        int32_t len = (int32_t) strlen(name);
        if (host_fs_access(name, len)) continue;
        if (directory) {
            if (host_fs_mkdir(name, len) != 0) {
                failure = UV_ENOENT;
                break;
            }
            req->ptr = name;
            req->path = name;
            return 0;
        }
        char *resolved = absolute_path(name);
        int32_t handle = resolved ? host_fs_open(name, len, 1) : -1;
        if (handle < 0) {
            free(resolved);
            failure = UV_ENOENT;
            break;
        }
        position_set(handle, resolved);
        req->ptr = name;
        req->path = name;
        return handle;
    }
    free(name);
    return failure;
}

int uv_fs_mkdtemp(uv_loop_t *loop, uv_fs_t *req, const char *tpl, uv_fs_cb cb) {
    req->fs_type = UV_FS_MKDTEMP;
    req->path = tpl;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, make_temp(req, tpl, 1));
}

int uv_fs_mkstemp(uv_loop_t *loop, uv_fs_t *req, const char *tpl, uv_fs_cb cb) {
    req->fs_type = UV_FS_MKSTEMP;
    req->path = tpl;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, make_temp(req, tpl, 0));
}

#define ATTR_MODE 0
#define ATTR_UID 1
#define ATTR_GID 2
#define ATTR_ATIME 3
#define ATTR_MTIME 4

static int64_t set_attr(const char *path, int follow, int attr, double value) {
    return host_fs_setattr(path, (int32_t) strlen(path), follow, attr, value) == 0 ? 0 : UV_ENOENT;
}

static int64_t set_owner(const char *path, int follow, uv_uid_t uid, uv_gid_t gid) {
    if (uid != (uv_uid_t) -1) {
        int64_t status = set_attr(path, follow, ATTR_UID, (double) uid);
        if (status != 0) return status;
    }
    if (gid != (uv_gid_t) -1) return set_attr(path, follow, ATTR_GID, (double) gid);
    return 0;
}

static int64_t set_times(const char *path, int follow, double atime, double mtime) {
    double now = (double) time(NULL);
    if (!isnan(atime)) {
        double seconds = isinf(atime) ? now : atime;
        int64_t status = set_attr(path, follow, ATTR_ATIME, seconds * 1000);
        if (status != 0) return status;
    }
    if (!isnan(mtime)) {
        double seconds = isinf(mtime) ? now : mtime;
        return set_attr(path, follow, ATTR_MTIME, seconds * 1000);
    }
    return 0;
}

static int64_t fd_path_status(uv_file file, int64_t (*action)(const char *path, void *arg), void *arg) {
    struct fd_position *slot = position_find(file);
    if (!slot) return UV_EBADF;
    return action(slot->path, arg);
}

static int64_t chmod_action(const char *path, void *arg) {
    return set_attr(path, 1, ATTR_MODE, (double) *(int *) arg);
}

static int64_t owner_action(const char *path, void *arg) {
    uv_uid_t *ids = arg;
    return set_owner(path, 1, ids[0], (uv_gid_t) ids[1]);
}

static int64_t times_action(const char *path, void *arg) {
    double *times = arg;
    return set_times(path, 1, times[0], times[1]);
}

int uv_fs_chmod(uv_loop_t *loop, uv_fs_t *req, const char *path, int mode, uv_fs_cb cb) {
    req->fs_type = UV_FS_CHMOD;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, set_attr(path, 1, ATTR_MODE, (double) mode));
}

int uv_fs_fchmod(uv_loop_t *loop, uv_fs_t *req, uv_file file, int mode, uv_fs_cb cb) {
    req->fs_type = UV_FS_FCHMOD;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, fd_path_status(file, chmod_action, &mode));
}

int uv_fs_chown(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_uid_t uid, uv_gid_t gid, uv_fs_cb cb) {
    req->fs_type = UV_FS_CHOWN;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, set_owner(path, 1, uid, gid));
}

int uv_fs_lchown(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_uid_t uid, uv_gid_t gid, uv_fs_cb cb) {
    req->fs_type = UV_FS_LCHOWN;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, set_owner(path, 0, uid, gid));
}

int uv_fs_fchown(uv_loop_t *loop, uv_fs_t *req, uv_file file, uv_uid_t uid, uv_gid_t gid, uv_fs_cb cb) {
    req->fs_type = UV_FS_FCHOWN;
    req->ptr = NULL;
    uv_uid_t ids[2] = {uid, (uv_uid_t) gid};
    return fs_finish(req, loop, cb, fd_path_status(file, owner_action, ids));
}

int uv_fs_utime(uv_loop_t *loop, uv_fs_t *req, const char *path, double atime, double mtime, uv_fs_cb cb) {
    req->fs_type = UV_FS_UTIME;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, set_times(path, 1, atime, mtime));
}

int uv_fs_lutime(uv_loop_t *loop, uv_fs_t *req, const char *path, double atime, double mtime, uv_fs_cb cb) {
    req->fs_type = UV_FS_LUTIME;
    req->path = path;
    req->ptr = NULL;
    return fs_finish(req, loop, cb, set_times(path, 0, atime, mtime));
}

int uv_fs_futime(uv_loop_t *loop, uv_fs_t *req, uv_file file, double atime, double mtime, uv_fs_cb cb) {
    req->fs_type = UV_FS_FUTIME;
    req->ptr = NULL;
    double times[2] = {atime, mtime};
    return fs_finish(req, loop, cb, fd_path_status(file, times_action, times));
}

int uv_fs_ftruncate(uv_loop_t *loop, uv_fs_t *req, uv_file file, int64_t offset, uv_fs_cb cb) {
    req->fs_type = UV_FS_FTRUNCATE;
    req->ptr = NULL;
    if (!position_find(file)) return fs_finish(req, loop, cb, UV_EBADF);
    int64_t result = host_fs_truncate(file, (int32_t) offset) == 0 ? 0 : UV_EIO;
    return fs_finish(req, loop, cb, result);
}

struct browser_dir {
    char *path;
    char *blob;
    char **names;
    size_t count;
    size_t next;
};

static uv_dirent_type_t dirent_type(const char *dir, const char *name) {
    size_t dir_len = strlen(dir);
    size_t name_len = strlen(name);
    char *full = malloc(dir_len + name_len + 2);
    if (!full) return UV_DIRENT_UNKNOWN;
    memcpy(full, dir, dir_len);
    full[dir_len] = '/';
    memcpy(full + dir_len + 1, name, name_len + 1);
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int32_t status = host_fs_lstat(full, (int32_t) (dir_len + 1 + name_len), slots);
    free(full);
    if (status != 0) return UV_DIRENT_UNKNOWN;
    if (slots[0] == 3) return UV_DIRENT_LINK;
    if (slots[0] == 2) return UV_DIRENT_DIR;
    return UV_DIRENT_FILE;
}

int uv_fs_opendir(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_OPENDIR;
    req->path = path;
    req->ptr = NULL;
    char *resolved = absolute_path(path);
    if (!resolved) return fs_finish(req, loop, cb, UV_ENAMETOOLONG);
    int32_t len = (int32_t) strlen(resolved);
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    if (host_fs_stat(resolved, len, slots) != 0) {
        free(resolved);
        return fs_finish(req, loop, cb, UV_ENOENT);
    }
    if (slots[0] != 2) {
        free(resolved);
        return fs_finish(req, loop, cb, UV_ENOTDIR);
    }
    size_t cap = 1024;
    char *blob = malloc(cap);
    int32_t total = blob ? host_fs_readdir(resolved, len, blob, (int32_t) cap) : -1;
    while (total > (int32_t) cap) {
        cap = (size_t) total;
        blob = grow_buffer(blob, cap);
        if (!blob) break;
        total = host_fs_readdir(resolved, len, blob, (int32_t) cap);
    }
    struct browser_dir *state = malloc(sizeof(*state));
    uv_dir_t *dir = malloc(sizeof(*dir));
    if (total < 0 || !blob || !state || !dir) {
        free(blob);
        free(state);
        free(dir);
        free(resolved);
        return fs_finish(req, loop, cb, total < 0 ? UV_EIO : UV_ENOMEM);
    }
    size_t count = 0;
    for (int32_t i = 0; i < total; i++) {
        if (blob[i] == '\0') count++;
    }
    state->names = malloc((count ? count : 1) * sizeof(char *));
    size_t index = 0;
    char *start = blob;
    for (int32_t i = 0; i < total && state->names; i++) {
        if (blob[i] != '\0') continue;
        state->names[index++] = start;
        start = blob + i + 1;
    }
    state->path = resolved;
    state->blob = blob;
    state->count = count;
    state->next = 0;
    dir->dirents = NULL;
    dir->nentries = 0;
    dir->dir = state;
    req->ptr = dir;
    return fs_finish(req, loop, cb, 0);
}

int uv_fs_readdir(uv_loop_t *loop, uv_fs_t *req, uv_dir_t *dir, uv_fs_cb cb) {
    req->fs_type = UV_FS_READDIR;
    req->ptr = NULL;
    struct browser_dir *state = dir ? dir->dir : NULL;
    if (!state || !dir->dirents) return fs_finish(req, loop, cb, UV_EINVAL);
    size_t filled = 0;
    while (filled < dir->nentries && state->next < state->count) {
        const char *name = state->names[state->next++];
        dir->dirents[filled].name = name;
        dir->dirents[filled].type = dirent_type(state->path, name);
        filled++;
    }
    return fs_finish(req, loop, cb, (int64_t) filled);
}

int uv_fs_closedir(uv_loop_t *loop, uv_fs_t *req, uv_dir_t *dir, uv_fs_cb cb) {
    req->fs_type = UV_FS_CLOSEDIR;
    req->ptr = NULL;
    if (!dir) return fs_finish(req, loop, cb, UV_EINVAL);
    struct browser_dir *state = dir->dir;
    if (state) {
        free(state->names);
        free(state->blob);
        free(state->path);
        free(state);
    }
    free(dir);
    return fs_finish(req, loop, cb, 0);
}

struct fs_wait {
    uv_fs_t *req;
    uv_loop_t *loop;
    int32_t id;
    struct fs_wait *next;
};

static struct fs_wait *waiting_flushes = NULL;
static int flushes_waiting = 0;

int tjs_fs_flushes_pending(void) {
    return flushes_waiting > 0;
}
static int32_t next_flush_id = 1;

void tjs_fs_release_loop(uv_loop_t *loop) {
    for (struct fs_wait **link = &waiting_flushes; *link;) {
        struct fs_wait *wait = *link;
        if (wait->loop != loop) {
            link = &wait->next;
            continue;
        }
        *link = wait->next;
        free(wait);
        flushes_waiting--;
    }
}

static int fs_flush(uv_fs_t *req, uv_loop_t *loop, uv_fs_cb cb) {
    if (!cb) return UV_ENOSYS;
    struct fs_wait *wait = malloc(sizeof(*wait));
    if (!wait) return fs_finish(req, loop, cb, UV_ENOMEM);
    wait->req = req;
    wait->loop = loop;
    wait->id = next_flush_id++;
    wait->next = waiting_flushes;
    waiting_flushes = wait;
    req->loop = loop;
    req->cb = cb;
    flushes_waiting++;
    host_fs_flush(wait->id);
    return 0;
}

void tjs_fs_flush_done(int32_t id, int32_t status) {
    for (struct fs_wait **link = &waiting_flushes; *link; link = &(*link)->next) {
        struct fs_wait *wait = *link;
        if (wait->id != id) continue;
        *link = wait->next;
        uv_fs_t *req = wait->req;
        uv_loop_t *loop = wait->loop;
        free(wait);
        flushes_waiting--;
        req->result = status == 0 ? 0 : UV_EIO;
        tjs_browser_defer(loop, fs_done, req);
        return;
    }
}

int uv_fs_fsync(uv_loop_t *loop, uv_fs_t *req, uv_file file, uv_fs_cb cb) {
    req->fs_type = UV_FS_FSYNC;
    req->ptr = NULL;
    if (!position_find(file)) return fs_finish(req, loop, cb, UV_EBADF);
    return fs_flush(req, loop, cb);
}

int uv_fs_fdatasync(uv_loop_t *loop, uv_fs_t *req, uv_file file, uv_fs_cb cb) {
    req->fs_type = UV_FS_FDATASYNC;
    req->ptr = NULL;
    if (!position_find(file)) return fs_finish(req, loop, cb, UV_EBADF);
    return fs_flush(req, loop, cb);
}

int uv_fs_link(uv_loop_t *loop, uv_fs_t *req, const char *path, const char *new_path, uv_fs_cb cb) {
    req->fs_type = UV_FS_LINK;
    req->path = path;
    req->ptr = NULL;
    int32_t status = host_fs_link(path, (int32_t) strlen(path), new_path, (int32_t) strlen(new_path));
    return fs_finish(req, loop, cb, status);
}

int uv_fs_statfs(uv_loop_t *loop, uv_fs_t *req, const char *path, uv_fs_cb cb) {
    req->fs_type = UV_FS_STATFS;
    req->path = path;
    req->ptr = NULL;
    double slots[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    if (host_fs_stat(path, (int32_t) strlen(path), slots) != 0) return fs_finish(req, loop, cb, UV_ENOENT);
    double quota[2] = {0, 0};
    if (host_fs_quota(quota) != 0) return fs_finish(req, loop, cb, UV_ENOSYS);
    uv_statfs_t *out = calloc(1, sizeof(*out));
    if (!out) return fs_finish(req, loop, cb, UV_ENOMEM);
    out->f_bsize = 4096;
    out->f_frsize = 4096;
    out->f_blocks = (uint64_t) (quota[0] / 4096);
    out->f_bfree = quota[0] > quota[1] ? (uint64_t) ((quota[0] - quota[1]) / 4096) : 0;
    out->f_bavail = out->f_bfree;
    req->ptr = out;
    return fs_finish(req, loop, cb, 0);
}

void uv_fs_req_cleanup(uv_fs_t *req) {
    if (req->fs_type == UV_FS_READLINK || req->fs_type == UV_FS_REALPATH || req->fs_type == UV_FS_MKDTEMP || req->fs_type == UV_FS_MKSTEMP || req->fs_type == UV_FS_STATFS) free(req->ptr);
    req->ptr = NULL;
}

HOST_IMPORT("tjs_random") void host_random(void *buf, int32_t len);

int uv_random(uv_loop_t *loop, uv_random_t *req, void *buf, size_t buflen, unsigned flags, uv_random_cb cb) {
    (void) loop;
    (void) req;
    (void) flags;
    if (cb) return UV_ENOSYS;
    uint8_t *out = buf;
    size_t left = buflen;
    while (left > 0) {
        size_t chunk = left > 65536 ? 65536 : left;
        host_random(out, (int32_t) chunk);
        out += chunk;
        left -= chunk;
    }
    return 0;
}

int uv_cwd(char *buffer, size_t *size) {
    char scratch[4096];
    int32_t len = host_fs_resolve(".", 1, scratch, (int32_t) sizeof(scratch));
    if (len < 0) {
        *size = sizeof(scratch);
        return UV_ENOBUFS;
    }
    if (*size <= (size_t) len) {
        *size = (size_t) len + 1;
        return UV_ENOBUFS;
    }
    memcpy(buffer, scratch, (size_t) len);
    buffer[len] = '\0';
    *size = (size_t) len;
    return 0;
}
