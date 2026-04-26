"""thebird shim: select — empty ready lists, no real I/O multiplexing."""
class error(Exception): pass
def select(rlist, wlist, xlist, timeout=None): return ([], [], [])
def poll(): return _Poll()
class _Poll:
    def register(self, fd, eventmask=0): pass
    def modify(self, fd, eventmask): pass
    def unregister(self, fd): pass
    def poll(self, timeout=None): return []
class epoll:
    def __init__(self, *a, **kw): pass
    def register(self, fd, eventmask=0): pass
    def modify(self, fd, eventmask): pass
    def unregister(self, fd): pass
    def poll(self, timeout=None, maxevents=-1): return []
    def close(self): pass
class kqueue:
    def __init__(self): pass
    def control(self, changes, max_events, timeout=None): return []
    def close(self): pass
PIPE_BUF = 4096
POLLIN = 1; POLLOUT = 4; POLLERR = 8; POLLHUP = 16
EPOLLIN = 1; EPOLLOUT = 4
