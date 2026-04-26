"""thebird shim: fcntl — file control no-ops on browser-FS."""
LOCK_SH = 1
LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8
F_GETFD = 1; F_SETFD = 2; F_GETFL = 3; F_SETFL = 4
FD_CLOEXEC = 1
def fcntl(fd, cmd, arg=0): return 0
def ioctl(fd, request, arg=0, mutate_flag=False): return 0
def flock(fd, operation): return None
def lockf(fd, cmd, length=0, start=0, whence=0): return None
