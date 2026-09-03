"""thebird shim: curses — bridges drawing to xterm via window.__debug.term."""
from js import window  # type: ignore

class error(Exception): pass

A_NORMAL = 0; A_BOLD = 1; A_REVERSE = 2; A_UNDERLINE = 4; A_BLINK = 8; A_DIM = 16; A_STANDOUT = 32
COLOR_BLACK = 0; COLOR_RED = 1; COLOR_GREEN = 2; COLOR_YELLOW = 3; COLOR_BLUE = 4; COLOR_MAGENTA = 5; COLOR_CYAN = 6; COLOR_WHITE = 7
KEY_UP = 259; KEY_DOWN = 258; KEY_LEFT = 260; KEY_RIGHT = 261; KEY_ENTER = 343; KEY_BACKSPACE = 263; KEY_RESIZE = 410

def _term():
    try: return window.__debug.term
    except Exception: return None

def _write(s):
    t = _term()
    if t:
        try: t.write(str(s))
        except Exception: pass

class _Win:
    def __init__(self):
        self._y = 0; self._x = 0; self._attr = 0
    def addstr(self, *a, **kw):
        # signatures: addstr(str), addstr(y,x,str), addstr(str,attr), addstr(y,x,str,attr)
        text = ''; attr = self._attr
        if len(a) == 1: text = a[0]
        elif len(a) == 2:
            if isinstance(a[0], str): text, attr = a
            else: pass
        elif len(a) >= 3:
            self._y, self._x, text = a[0], a[1], a[2]
            if len(a) > 3: attr = a[3]
        prefix = f'\x1b[{int(self._y)+1};{int(self._x)+1}H' if (self._y or self._x) else ''
        codes = ''
        if attr & A_BOLD: codes += '\x1b[1m'
        if attr & A_REVERSE: codes += '\x1b[7m'
        if attr & A_UNDERLINE: codes += '\x1b[4m'
        reset = '\x1b[0m' if codes else ''
        _write(prefix + codes + str(text) + reset)
    def addnstr(self, *a, **kw):
        if len(a) >= 2 and isinstance(a[-1], int): self.addstr(*a[:-1], **kw)
        else: self.addstr(*a, **kw)
    def getch(self, *a): return -1
    def getstr(self, *a): return b''
    def refresh(self): pass
    def clear(self): _write('\x1b[2J\x1b[H')
    def erase(self): _write('\x1b[2J\x1b[H')
    def move(self, y, x): self._y = y; self._x = x; _write(f'\x1b[{int(y)+1};{int(x)+1}H')
    def getmaxyx(self):
        t = _term()
        try:
            return (int(t.rows or 24), int(t.cols or 80)) if t else (24, 80)
        except Exception: return (24, 80)
    def keypad(self, flag): pass
    def nodelay(self, flag): pass
    def timeout(self, ms): pass
    def attron(self, attr): self._attr |= attr
    def attroff(self, attr): self._attr &= ~attr
    def attrset(self, attr): self._attr = attr
    def border(self, *a): pass
    def box(self, *a): pass
    def subwin(self, *a, **kw): return _Win()
    def derwin(self, *a, **kw): return _Win()
    def resize(self, h, w): pass

def initscr(): _write('\x1b[2J\x1b[H'); return _Win()
def endwin(): _write('\x1b[0m')
def cbreak(): pass
def nocbreak(): pass
def echo(): pass
def noecho(): pass
def curs_set(v): _write('\x1b[?25h' if v else '\x1b[?25l')
def newwin(*a, **kw): return _Win()
def wrapper(fn, *a, **kw):
    w = initscr()
    try: return fn(w, *a, **kw)
    finally: endwin()
def has_colors(): return True
def start_color(): pass
def init_pair(n, fg, bg): pass
def color_pair(n): return 0
def use_default_colors(): pass
def def_prog_mode(): pass
def reset_prog_mode(): pass
def def_shell_mode(): pass
def reset_shell_mode(): pass
def doupdate(): pass

ascii = type('ascii', (), {'isascii': staticmethod(lambda c: True)})()
