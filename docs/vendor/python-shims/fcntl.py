"""thebird shim: fcntl — bridges to window.__debug.shell.fdTable for real fd ops."""
from js import window  # type: ignore

LOCK_SH = 1
LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8
F_GETFD = 1; F_SETFD = 2; F_GETFL = 3; F_SETFL = 4
F_DUPFD = 0; F_DUPFD_CLOEXEC = 1030
FD_CLOEXEC = 1

def _fdtable():
    try: return window.__debug.shell.fdTable
    except Exception: return None

_flags = {}
_locks = {}

def fcntl(fd, cmd, arg=0):
    fd = int(fd)
    if cmd in (F_GETFD, F_GETFL): return _flags.get((fd, cmd), 0)
    if cmd in (F_SETFD, F_SETFL): _flags[(fd, cmd)] = int(arg); return 0
    if cmd in (F_DUPFD, F_DUPFD_CLOEXEC):
        ft = _fdtable()
        if ft and hasattr(ft, 'dup2'):
            try: ft.dup2(fd, int(arg)); return int(arg)
            except Exception: pass
        return int(arg)
    return 0

def ioctl(fd, request, arg=0, mutate_flag=False):
    return 0

def flock(fd, operation):
    fd = int(fd)
    op = int(operation)
    if op & LOCK_UN: _locks.pop(fd, None)
    else: _locks[fd] = op
    return None

def lockf(fd, cmd, length=0, start=0, whence=0):
    return flock(fd, cmd)
