"""thebird shim: termios — bridges to xterm modes via window.__debug.term."""
from js import window  # type: ignore

TCSANOW = 0; TCSADRAIN = 1; TCSAFLUSH = 2
TCIFLUSH = 0; TCOFLUSH = 1; TCIOFLUSH = 2
TCOOFF = 0; TCOON = 1; TCIOFF = 2; TCION = 3
ICANON = 2; ECHO = 8; ISIG = 1; IEXTEN = 0o100000

# attr indices: [iflag, oflag, cflag, lflag, ispeed, ospeed, cc]
_state = {}

class error(Exception): pass

def _term():
    try: return window.__debug.term
    except Exception: return None

def tcgetattr(fd):
    fd = int(fd)
    if fd in _state: return list(_state[fd])
    # default: canonical mode + echo on (cooked)
    return [0, 0, 0, ICANON | ECHO | ISIG, 0, 0, [0]*32]

def tcsetattr(fd, when, attr):
    fd = int(fd); _state[fd] = list(attr)
    t = _term()
    if not t: return None
    lflag = attr[3] if len(attr) > 3 else 0
    try:
        # ICANON off → enable raw-ish mode by hiding cursor + sending raw signal
        if not (lflag & ICANON):
            t.write('\x1b[?25h')  # cursor visible (mode change marker)
        # ECHO state purely informational; xterm's local-echo isn't toggled here
    except Exception: pass
    return None

def tcsendbreak(fd, duration):
    t = _term()
    try:
        if t: t.write('\x03')  # send Ctrl-C as break-equivalent
    except Exception: pass
    return None

def tcdrain(fd): return None
def tcflush(fd, queue): return None
def tcflow(fd, action): return None
