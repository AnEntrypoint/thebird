"""thebird shim: msvcrt — Windows console I/O bridges to xterm."""
from js import window  # type: ignore

LK_LOCK = 1; LK_NBLCK = 2; LK_RLCK = 1; LK_NBRLCK = 2; LK_UNLCK = 0

def _term():
    try: return window.__debug.term
    except Exception: return None

def _shell_input_buffer():
    """Read pending input from thebird shell's queue (drained on access)."""
    try:
        q = window.__debug.shell.inputQueue
        # inputQueue is a getter that returns a copy; thebird drains via term.onData
        return list(q.to_py()) if hasattr(q, 'to_py') else list(q or [])
    except Exception: return []

def getch():
    buf = _shell_input_buffer()
    if buf and buf[0]:
        c = buf[0][0:1]
        return c.encode('latin-1') if isinstance(c, str) else bytes([c])
    return b''

def getche():
    c = getch()
    t = _term()
    if t and c:
        try: t.write(c.decode('latin-1') if isinstance(c, (bytes, bytearray)) else str(c))
        except Exception: pass
    return c

def getwch():
    c = getch()
    return c.decode('latin-1') if c else ''

def getwche():
    c = getche()
    return c.decode('latin-1') if c else ''

def kbhit():
    return bool(_shell_input_buffer())

def putch(c):
    t = _term()
    if t:
        try: t.write(c.decode('latin-1') if isinstance(c, (bytes, bytearray)) else str(c))
        except Exception: pass

def putwch(c):
    putch(c)

def ungetch(c): pass
def ungetwch(c): pass

def setmode(fd, mode): return 0
def open_osfhandle(handle, flags): return int(handle) if isinstance(handle, int) else 0
def get_osfhandle(fd): return int(fd)

def heapmin(): pass
