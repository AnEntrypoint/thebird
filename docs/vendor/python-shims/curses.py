"""thebird shim: curses — TUI not available; window ops are no-ops."""
class error(Exception): pass
A_NORMAL = 0; A_BOLD = 1; A_REVERSE = 2; A_UNDERLINE = 4; A_BLINK = 8; A_DIM = 16; A_STANDOUT = 32
COLOR_BLACK = 0; COLOR_RED = 1; COLOR_GREEN = 2; COLOR_YELLOW = 3; COLOR_BLUE = 4; COLOR_MAGENTA = 5; COLOR_CYAN = 6; COLOR_WHITE = 7
KEY_UP = 259; KEY_DOWN = 258; KEY_LEFT = 260; KEY_RIGHT = 261; KEY_ENTER = 343; KEY_BACKSPACE = 263; KEY_RESIZE = 410
class _Win:
    def addstr(self, *a, **kw): pass
    def addnstr(self, *a, **kw): pass
    def getch(self, *a): return -1
    def getstr(self, *a): return b''
    def refresh(self): pass
    def clear(self): pass
    def erase(self): pass
    def move(self, y, x): pass
    def getmaxyx(self): return (24, 80)
    def keypad(self, flag): pass
    def nodelay(self, flag): pass
    def timeout(self, ms): pass
    def attron(self, attr): pass
    def attroff(self, attr): pass
    def attrset(self, attr): pass
    def border(self, *a): pass
    def box(self, *a): pass
    def subwin(self, *a, **kw): return _Win()
    def derwin(self, *a, **kw): return _Win()
    def resize(self, h, w): pass
def initscr(): return _Win()
def endwin(): pass
def cbreak(): pass
def nocbreak(): pass
def echo(): pass
def noecho(): pass
def curs_set(v): pass
def newwin(*a, **kw): return _Win()
def wrapper(fn, *a, **kw): return fn(_Win(), *a, **kw)
def has_colors(): return False
def start_color(): pass
def init_pair(n, fg, bg): pass
def color_pair(n): return 0
def use_default_colors(): pass
def def_prog_mode(): pass
def reset_prog_mode(): pass
def def_shell_mode(): pass
def reset_shell_mode(): pass
def doupdate(): pass
def panel(*a, **kw): return _Win()
ascii = type('ascii', (), {'isascii': staticmethod(lambda c: True)})()
