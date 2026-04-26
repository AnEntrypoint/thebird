"""thebird shim: winpty — bridges PTY to thebird shell + xterm."""
from js import window  # type: ignore

def _shell():
    try: return window.__debug.shell
    except Exception: return None

def _term():
    try: return window.__debug.term
    except Exception: return None

class WinPty:
    def __init__(self, appname=None, cmdline=None, cwd=None, env=None, dimensions=None):
        self._cmd = cmdline or appname or ''
        self._buf = []
        self._alive = True
        self._exit = 0
        sh = _shell()
        if sh and self._cmd:
            try: sh.run(str(self._cmd)); self._exit = int(sh.lastExitCode or 0); self._alive = False
            except Exception: self._alive = False; self._exit = 1
    def write(self, data):
        sh = _shell()
        if sh:
            try:
                # If the spawned command finished, treat data as new input → run it
                if not self._alive: sh.run(str(data) if not isinstance(data, (bytes, bytearray)) else data.decode('latin-1', 'replace'))
            except Exception: pass
        return len(data) if data else 0
    def read(self, n=4096):
        # xterm output is the canonical sink; nothing to read back here
        return b''
    def close(self): self._alive = False
    def isalive(self): return self._alive
    def get_exitstatus(self): return self._exit
    def setwinsize(self, rows, cols):
        t = _term()
        if t:
            try: t.resize(int(cols), int(rows))
            except Exception: pass

PTY = WinPty
