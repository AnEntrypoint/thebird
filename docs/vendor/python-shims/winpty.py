"""thebird shim: winpty — no PTY in browser."""
class WinPty:
    def __init__(self, *a, **kw): pass
    def write(self, data): return len(data) if data else 0
    def read(self, n=4096): return b''
    def close(self): pass
    def isalive(self): return False
    def get_exitstatus(self): return 0
PTY = WinPty
