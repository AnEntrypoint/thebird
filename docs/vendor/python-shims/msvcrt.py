"""thebird shim: msvcrt — Windows console I/O no-ops (Pyodide isn't Windows)."""
def getch(): return b''
def getche(): return b''
def getwch(): return ''
def getwche(): return ''
def kbhit(): return False
def putch(c): pass
def putwch(c): pass
def ungetch(c): pass
def ungetwch(c): pass
def setmode(fd, mode): return 0
def open_osfhandle(handle, flags): return 0
def get_osfhandle(fd): return 0
def heapmin(): pass
LK_LOCK = 1; LK_NBLCK = 2; LK_RLCK = 1; LK_NBRLCK = 2; LK_UNLCK = 0
