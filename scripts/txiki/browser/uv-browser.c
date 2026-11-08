#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <uv.h>

#define TXIKI_REF 0x1u
#define TXIKI_ACTIVE 0x2u
#define TXIKI_CLOSING 0x4u
#define TXIKI_CLOSED 0x8u

__attribute__((import_module("env"), import_name("tjs_host_arm"))) void tjs_host_arm(double delay_ms);
__attribute__((import_module("env"), import_name("tjs_host_write"))) void tjs_host_write(int fd, const char *base, unsigned int len);

static uint64_t now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t) ts.tv_sec * 1000u + (uint64_t) ts.tv_nsec / 1000000u;
}

static void queue_init(struct uv__queue *q) {
    q->next = q;
    q->prev = q;
}

static void queue_insert_tail(struct uv__queue *head, struct uv__queue *node) {
    node->next = head;
    node->prev = head->prev;
    head->prev->next = node;
    head->prev = node;
}

static void queue_remove(struct uv__queue *node) {
    node->prev->next = node->next;
    node->next->prev = node->prev;
    node->next = node;
    node->prev = node;
}

static void handle_set_active(uv_handle_t *handle, int active) {
    int was = (handle->flags & TXIKI_ACTIVE) != 0;
    if (active == was) return;
    if (active) handle->flags |= TXIKI_ACTIVE;
    else handle->flags &= ~TXIKI_ACTIVE;
    if (handle->flags & TXIKI_REF) {
        if (active) handle->loop->active_handles++;
        else handle->loop->active_handles--;
    }
}

static void handle_init(uv_loop_t *loop, uv_handle_t *handle, uv_handle_type type) {
    handle->loop = loop;
    handle->type = type;
    handle->data = NULL;
    handle->close_cb = NULL;
    handle->flags = TXIKI_REF;
    handle->next_closing = NULL;
}

static void pending_push(uv_loop_t *loop, void (*fn)(void *arg), void *arg) {
    struct uv__pending *node = malloc(sizeof(*node));
    node->fn = fn;
    node->arg = arg;
    node->next = NULL;
    if (loop->pending_tail) loop->pending_tail->next = node;
    else loop->pending_head = node;
    loop->pending_tail = node;
}

static int run_pending(uv_loop_t *loop) {
    int ran = 0;
    while (loop->pending_head) {
        struct uv__pending *node = loop->pending_head;
        loop->pending_head = node->next;
        if (!loop->pending_head) loop->pending_tail = NULL;
        node->fn(node->arg);
        free(node);
        ran = 1;
    }
    return ran;
}

static int run_closing(uv_loop_t *loop) {
    int ran = 0;
    while (loop->closing_handles) {
        uv_handle_t *handle = loop->closing_handles;
        loop->closing_handles = handle->next_closing;
        handle->next_closing = NULL;
        handle->flags = (handle->flags & ~TXIKI_CLOSING) | TXIKI_CLOSED;
        if (handle->close_cb) handle->close_cb(handle);
        ran = 1;
    }
    return ran;
}

static int run_timers(uv_loop_t *loop) {
    int ran = 0;
    for (;;) {
        uv_timer_t *due = NULL;
        for (uv_timer_t *t = loop->timers; t; t = t->next_timer) {
            if (t->timeout <= loop->time && (!due || t->timeout < due->timeout)) due = t;
        }
        if (!due) break;
        if (due->repeat) due->timeout = loop->time + due->repeat;
        else uv_timer_stop(due);
        if (due->timer_cb) due->timer_cb(due);
        ran = 1;
    }
    return ran;
}

static int run_idle_handles(struct uv__queue *head) {
    int ran = 0;
    for (struct uv__queue *q = head->next; q != head;) {
        struct uv__queue *next = q->next;
        uv_idle_t *idle = (uv_idle_t *) ((char *) q - offsetof(uv_idle_t, queue));
        if (idle->idle_cb) idle->idle_cb(idle);
        ran = 1;
        q = next;
    }
    return ran;
}

static int run_prepare_handles(struct uv__queue *head) {
    int ran = 0;
    for (struct uv__queue *q = head->next; q != head;) {
        struct uv__queue *next = q->next;
        uv_prepare_t *prepare = (uv_prepare_t *) ((char *) q - offsetof(uv_prepare_t, queue));
        if (prepare->prepare_cb) prepare->prepare_cb(prepare);
        ran = 1;
        q = next;
    }
    return ran;
}

static int run_check_handles(struct uv__queue *head) {
    int ran = 0;
    for (struct uv__queue *q = head->next; q != head;) {
        struct uv__queue *next = q->next;
        uv_check_t *check = (uv_check_t *) ((char *) q - offsetof(uv_check_t, queue));
        if (check->check_cb) check->check_cb(check);
        ran = 1;
        q = next;
    }
    return ran;
}

static uint64_t next_timer_delay(uv_loop_t *loop) {
    uint64_t best = 0;
    int found = 0;
    for (uv_timer_t *t = loop->timers; t; t = t->next_timer) {
        uint64_t delay = t->timeout > loop->time ? t->timeout - loop->time : 0;
        if (!found || delay < best) best = delay;
        found = 1;
    }
    return best;
}

int uv_loop_init(uv_loop_t *loop) {
    memset(loop, 0, sizeof(*loop));
    queue_init(&loop->idle_handles);
    queue_init(&loop->prepare_handles);
    queue_init(&loop->check_handles);
    queue_init(&loop->async_handles);
    loop->time = now_ms();
    return 0;
}

int uv_loop_close(uv_loop_t *loop) {
    if (uv_loop_alive(loop)) return UV_EBUSY;
    return 0;
}

int uv_loop_alive(const uv_loop_t *loop) {
    return loop->active_handles > 0 || loop->closing_handles != NULL || loop->pending_head != NULL;
}

void uv_update_time(uv_loop_t *loop) {
    loop->time = now_ms();
}

void uv_stop(uv_loop_t *loop) {
    loop->stop_flag = 1;
}

int uv_run(uv_loop_t *loop, uv_run_mode mode) {
    loop->stop_flag = 0;
    do {
        uv_update_time(loop);
        int progressed = 0;
        progressed |= run_timers(loop);
        progressed |= run_pending(loop);
        progressed |= run_prepare_handles(&loop->prepare_handles);
        progressed |= run_idle_handles(&loop->idle_handles);
        progressed |= run_check_handles(&loop->check_handles);
        progressed |= run_closing(loop);
        if (mode == UV_RUN_NOWAIT || loop->stop_flag) break;
        if (progressed) continue;
        if (!uv_loop_alive(loop)) break;
        if (mode == UV_RUN_ONCE) break;
        if (loop->timers) {
            tjs_host_arm((double) next_timer_delay(loop));
            break;
        }
        break;
    } while (uv_loop_alive(loop));
    return uv_loop_alive(loop);
}

void uv_ref(uv_handle_t *handle) {
    if (handle->flags & TXIKI_REF) return;
    handle->flags |= TXIKI_REF;
    if (handle->flags & TXIKI_ACTIVE) handle->loop->active_handles++;
}

void uv_unref(uv_handle_t *handle) {
    if (!(handle->flags & TXIKI_REF)) return;
    handle->flags &= ~TXIKI_REF;
    if (handle->flags & TXIKI_ACTIVE) handle->loop->active_handles--;
}

int uv_has_ref(const uv_handle_t *handle) {
    return (handle->flags & TXIKI_REF) != 0;
}

int uv_is_active(const uv_handle_t *handle) {
    return (handle->flags & TXIKI_ACTIVE) != 0;
}

int uv_is_closing(const uv_handle_t *handle) {
    return (handle->flags & (TXIKI_CLOSING | TXIKI_CLOSED)) != 0;
}

void uv_close(uv_handle_t *handle, uv_close_cb close_cb) {
    if (uv_is_closing(handle)) return;
    handle_set_active(handle, 0);
    if (handle->type == UV_TIMER) uv_timer_stop((uv_timer_t *) handle);
    handle->flags |= TXIKI_CLOSING;
    handle->close_cb = close_cb;
    handle->next_closing = handle->loop->closing_handles;
    handle->loop->closing_handles = handle;
}

int uv_timer_init(uv_loop_t *loop, uv_timer_t *timer) {
    handle_init(loop, (uv_handle_t *) timer, UV_TIMER);
    timer->timer_cb = NULL;
    timer->next_timer = NULL;
    timer->timeout = 0;
    timer->repeat = 0;
    return 0;
}

int uv_timer_start(uv_timer_t *timer, uv_timer_cb cb, uint64_t timeout, uint64_t repeat) {
    if (uv_is_closing((uv_handle_t *) timer)) return UV_EINVAL;
    uv_timer_stop(timer);
    timer->timer_cb = cb;
    timer->timeout = now_ms() + timeout;
    timer->repeat = repeat;
    timer->next_timer = timer->loop->timers;
    timer->loop->timers = timer;
    handle_set_active((uv_handle_t *) timer, 1);
    return 0;
}

int uv_timer_stop(uv_timer_t *timer) {
    uv_loop_t *loop = timer->loop;
    uv_timer_t **link = &loop->timers;
    while (*link && *link != timer) link = &(*link)->next_timer;
    if (*link == timer) *link = timer->next_timer;
    timer->next_timer = NULL;
    handle_set_active((uv_handle_t *) timer, 0);
    return 0;
}

int uv_idle_init(uv_loop_t *loop, uv_idle_t *idle) {
    handle_init(loop, (uv_handle_t *) idle, UV_IDLE);
    idle->idle_cb = NULL;
    queue_init(&idle->queue);
    return 0;
}

int uv_idle_start(uv_idle_t *idle, uv_idle_cb cb) {
    if (uv_is_active((uv_handle_t *) idle)) return 0;
    idle->idle_cb = cb;
    queue_insert_tail(&idle->loop->idle_handles, &idle->queue);
    handle_set_active((uv_handle_t *) idle, 1);
    return 0;
}

int uv_idle_stop(uv_idle_t *idle) {
    if (!uv_is_active((uv_handle_t *) idle)) return 0;
    queue_remove(&idle->queue);
    handle_set_active((uv_handle_t *) idle, 0);
    return 0;
}

int uv_prepare_init(uv_loop_t *loop, uv_prepare_t *prepare) {
    handle_init(loop, (uv_handle_t *) prepare, UV_PREPARE);
    prepare->prepare_cb = NULL;
    queue_init(&prepare->queue);
    return 0;
}

int uv_prepare_start(uv_prepare_t *prepare, uv_prepare_cb cb) {
    if (uv_is_active((uv_handle_t *) prepare)) return 0;
    prepare->prepare_cb = cb;
    queue_insert_tail(&prepare->loop->prepare_handles, &prepare->queue);
    handle_set_active((uv_handle_t *) prepare, 1);
    return 0;
}

int uv_prepare_stop(uv_prepare_t *prepare) {
    if (!uv_is_active((uv_handle_t *) prepare)) return 0;
    queue_remove(&prepare->queue);
    handle_set_active((uv_handle_t *) prepare, 0);
    return 0;
}

int uv_check_init(uv_loop_t *loop, uv_check_t *check) {
    handle_init(loop, (uv_handle_t *) check, UV_CHECK);
    check->check_cb = NULL;
    queue_init(&check->queue);
    return 0;
}

int uv_check_start(uv_check_t *check, uv_check_cb cb) {
    if (uv_is_active((uv_handle_t *) check)) return 0;
    check->check_cb = cb;
    queue_insert_tail(&check->loop->check_handles, &check->queue);
    handle_set_active((uv_handle_t *) check, 1);
    return 0;
}

int uv_check_stop(uv_check_t *check) {
    if (!uv_is_active((uv_handle_t *) check)) return 0;
    queue_remove(&check->queue);
    handle_set_active((uv_handle_t *) check, 0);
    return 0;
}

static void async_fire(void *arg) {
    uv_async_t *async = arg;
    async->pending = 0;
    if (async->async_cb) async->async_cb(async);
}

int uv_async_init(uv_loop_t *loop, uv_async_t *async, uv_async_cb async_cb) {
    handle_init(loop, (uv_handle_t *) async, UV_ASYNC);
    async->async_cb = async_cb;
    async->pending = 0;
    queue_init(&async->queue);
    queue_insert_tail(&loop->async_handles, &async->queue);
    handle_set_active((uv_handle_t *) async, 1);
    return 0;
}

int uv_async_send(uv_async_t *async) {
    if (async->pending) return 0;
    async->pending = 1;
    pending_push(async->loop, async_fire, async);
    return 0;
}

static void write_done(void *arg) {
    uv_write_t *req = arg;
    if (req->cb) req->cb(req, 0);
}

static void shutdown_done(void *arg) {
    uv_shutdown_t *req = arg;
    if (req->cb) req->cb(req, 0);
}

static size_t write_bufs(uv_stream_t *stream, const uv_buf_t bufs[], unsigned int nbufs) {
    size_t total = 0;
    for (unsigned int i = 0; i < nbufs; i++) {
        if (stream->type == UV_TTY) tjs_host_write(((uv_tty_t *) stream)->fd, bufs[i].base, (unsigned int) bufs[i].len);
        total += bufs[i].len;
    }
    return total;
}

int uv_write(uv_write_t *req, uv_stream_t *stream, const uv_buf_t bufs[], unsigned int nbufs, uv_write_cb cb) {
    write_bufs(stream, bufs, nbufs);
    req->type = UV_WRITE;
    req->handle = stream;
    req->cb = cb;
    req->error = 0;
    pending_push(stream->loop, write_done, req);
    return 0;
}

int uv_try_write(uv_stream_t *stream, const uv_buf_t bufs[], unsigned int nbufs) {
    return (int) write_bufs(stream, bufs, nbufs);
}

int uv_shutdown(uv_shutdown_t *req, uv_stream_t *stream, uv_shutdown_cb cb) {
    req->type = UV_SHUTDOWN;
    req->handle = stream;
    req->cb = cb;
    pending_push(stream->loop, shutdown_done, req);
    return 0;
}

int uv_read_start(uv_stream_t *stream, uv_alloc_cb alloc_cb, uv_read_cb read_cb) {
    stream->alloc_cb = alloc_cb;
    stream->read_cb = read_cb;
    handle_set_active((uv_handle_t *) stream, 1);
    return 0;
}

int uv_read_stop(uv_stream_t *stream) {
    handle_set_active((uv_handle_t *) stream, 0);
    return 0;
}

int uv_tty_init(uv_loop_t *loop, uv_tty_t *tty, uv_file fd, int readable) {
    (void) readable;
    handle_init(loop, (uv_handle_t *) tty, UV_TTY);
    tty->fd = fd;
    return 0;
}

int uv_tty_get_winsize(uv_tty_t *tty, int *width, int *height) {
    (void) tty;
    *width = 80;
    *height = 24;
    return 0;
}

int uv_tty_set_mode(uv_tty_t *tty, uv_tty_mode_t mode) {
    (void) tty;
    (void) mode;
    return 0;
}

int uv_tty_reset_mode(void) {
    return 0;
}

int uv_stream_set_blocking(uv_stream_t *stream, int blocking) {
    (void) stream;
    (void) blocking;
    return 0;
}

uv_handle_type uv_guess_handle(uv_file file) {
    return file >= 0 && file <= 2 ? UV_TTY : UV_FILE;
}

int uv_fileno(const uv_handle_t *handle, uv_os_fd_t *fd) {
    if (handle->type != UV_TTY) return UV_EINVAL;
    *fd = ((const uv_tty_t *) handle)->fd;
    return 0;
}

uv_buf_t uv_buf_init(char *base, unsigned int len) {
    uv_buf_t buf;
    buf.base = base;
    buf.len = len;
    return buf;
}

const char *uv_version_string(void) {
    return "1.53.0";
}

const char *uv_err_name(int err) {
    switch (err) {
#define XX(name, _) case UV_##name: return #name;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return "UNKNOWN";
}

const char *uv_strerror(int err) {
    switch (err) {
#define XX(name, msg) case UV_##name: return msg;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return "unknown error";
}
