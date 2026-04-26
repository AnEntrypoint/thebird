"""thebird shim: ptyprocess — no PTY in browser."""
class PtyProcessError(Exception): pass
class ExceptionPexpect(Exception): pass
class TIMEOUT(Exception): pass
class EOF(Exception): pass
class PtyProcess:
    @classmethod
    def spawn(cls, argv, **kw): return cls()
    def __init__(self): self.pid = 0; self.exitstatus = 0
    def read(self, size=1024): return b''
    def write(self, data): return len(data) if data else 0
    def close(self, force=False): pass
    def isalive(self): return False
    def kill(self, sig=15): pass
    def terminate(self, force=False): pass
    def wait(self): return 0
    def setwinsize(self, rows, cols): pass
class PtyProcessUnicode(PtyProcess):
    def read(self, size=1024): return ''
    def write(self, data): return len(data) if data else 0
