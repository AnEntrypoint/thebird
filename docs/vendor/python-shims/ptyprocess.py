"""thebird shim: ptyprocess — bridges PTY to thebird shell + xterm.

Matches pexpect's PtyProcess API. spawn() runs commands through thebird
shell; read()/write() bridge to xterm input queue + terminal output."""
from js import window  # type: ignore

class PtyProcessError(Exception): pass
class ExceptionPexpect(Exception): pass
class TIMEOUT(Exception): pass
class EOF(Exception): pass

def _shell():
    try: return window.__debug.shell
    except Exception: return None

def _term():
    try: return window.__debug.term
    except Exception: return None

class PtyProcess:
    @classmethod
    def spawn(cls, argv, cwd=None, env=None, echo=True, dimensions=(24, 80)):
        inst = cls()
        sh = _shell()
        if sh:
            try:
                cmd = ' '.join(argv) if isinstance(argv, list) else str(argv)
                sh.run(cmd)
                inst.exitstatus = int(sh.lastExitCode or 0)
                inst._alive = False
            except Exception:
                inst._alive = False; inst.exitstatus = 1
        return inst

    def __init__(self):
        self.pid = 0
        self.exitstatus = 0
        self._alive = True
        self._closed = False

    def read(self, size=1024):
        try:
            q = window.__debug.shell.inputQueue
            data = list(q.to_py()) if hasattr(q, 'to_py') else list(q or [])
            if not data: return b''
            buf = ''.join(data)[:size]
            return buf.encode('latin-1', 'replace')
        except Exception: return b''

    def write(self, data):
        sh = _shell()
        if sh:
            try:
                text = data.decode('latin-1', 'replace') if isinstance(data, (bytes, bytearray)) else str(data)
                if text.endswith('\n') or text.endswith('\r'):
                    sh.run(text.rstrip('\r\n'))
                else:
                    t = _term()
                    if t: t.write(text)
            except Exception: pass
        return len(data) if data else 0

    def close(self, force=False):
        self._closed = True; self._alive = False

    def isalive(self):
        return self._alive and not self._closed

    def kill(self, sig=15):
        self._alive = False; self.exitstatus = -sig

    def terminate(self, force=False): self.kill()

    def wait(self): return self.exitstatus

    def setwinsize(self, rows, cols):
        t = _term()
        if t:
            try: t.resize(int(cols), int(rows))
            except Exception: pass

class PtyProcessUnicode(PtyProcess):
    def read(self, size=1024):
        b = super().read(size)
        return b.decode('utf-8', 'replace') if isinstance(b, (bytes, bytearray)) else b
    def write(self, data):
        s = data if isinstance(data, str) else data.decode('latin-1', 'replace')
        return super().write(s)
