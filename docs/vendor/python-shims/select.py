"""thebird shim: select — bridges fd readiness to thebird's fdTable."""
from js import window  # type: ignore

class error(Exception): pass

def _fdtable():
    try: return window.__debug.shell.fdTable
    except Exception: return None

def _has_input():
    try:
        q = window.__debug.shell.inputQueue
        return bool(list(q.to_py())) if hasattr(q, 'to_py') else bool(list(q or []))
    except Exception: return False

def select(rlist, wlist, xlist, timeout=None):
    """Poll readability; in WASM there's no real blocking-poll. Treat fd 0
    as readable iff thebird's input queue has data; all writable fds always
    ready; no exception fds. Sleep-equivalent via a minimal yield."""
    rready = []
    for fd in rlist:
        try:
            if int(fd) == 0:
                if _has_input(): rready.append(fd)
            else:
                # Other fds: defer to fdTable if present
                ft = _fdtable()
                if ft and hasattr(ft, 'readFd'):
                    try:
                        # If readFd returns non-empty, fd has data
                        d = ft.readFd(int(fd))
                        if d: rready.append(fd)
                    except Exception: pass
        except Exception: pass
    return (rready, list(wlist), [])

class _Poll:
    def __init__(self): self._fds = {}
    def register(self, fd, eventmask=0): self._fds[int(fd)] = int(eventmask)
    def modify(self, fd, eventmask): self._fds[int(fd)] = int(eventmask)
    def unregister(self, fd): self._fds.pop(int(fd), None)
    def poll(self, timeout=None):
        out = []
        for fd, mask in self._fds.items():
            if mask & POLLIN and ((fd == 0 and _has_input()) or (fd != 0)):
                out.append((fd, POLLIN))
        return out

def poll(): return _Poll()

class epoll:
    def __init__(self, *a, **kw): self._fds = {}
    def register(self, fd, eventmask=0): self._fds[int(fd)] = int(eventmask)
    def modify(self, fd, eventmask): self._fds[int(fd)] = int(eventmask)
    def unregister(self, fd): self._fds.pop(int(fd), None)
    def poll(self, timeout=None, maxevents=-1):
        out = []
        for fd, mask in self._fds.items():
            if mask & POLLIN and ((fd == 0 and _has_input()) or (fd != 0)):
                out.append((fd, POLLIN))
        return out
    def close(self): self._fds.clear()

class kqueue:
    def __init__(self): pass
    def control(self, changes, max_events, timeout=None): return []
    def close(self): pass

PIPE_BUF = 4096
POLLIN = 1; POLLOUT = 4; POLLERR = 8; POLLHUP = 16
EPOLLIN = 1; EPOLLOUT = 4
