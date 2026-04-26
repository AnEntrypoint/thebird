"""thebird shim: subprocess — no host process; calls return empty results."""
import sys

PIPE = -1
STDOUT = -2
DEVNULL = -3

class TimeoutExpired(Exception):
    def __init__(self, cmd, timeout, output=None, stderr=None):
        self.cmd = cmd; self.timeout = timeout; self.output = output; self.stderr = stderr
        super().__init__(f"Command {cmd!r} timed out after {timeout}s")

class CalledProcessError(Exception):
    def __init__(self, returncode, cmd, output=None, stderr=None):
        self.returncode = returncode; self.cmd = cmd; self.output = output; self.stderr = stderr
        super().__init__(f"Command {cmd!r} returned non-zero exit status {returncode}")

class CompletedProcess:
    def __init__(self, args, returncode, stdout=None, stderr=None):
        self.args = args; self.returncode = returncode; self.stdout = stdout; self.stderr = stderr
    def check_returncode(self):
        if self.returncode: raise CalledProcessError(self.returncode, self.args, self.stdout, self.stderr)

class Popen:
    def __init__(self, args, **kw):
        self.args = args; self.returncode = 0; self.pid = 0
        self.stdin = self.stdout = self.stderr = None
    def communicate(self, input=None, timeout=None): return (b'', b'')
    def wait(self, timeout=None): return 0
    def poll(self): return 0
    def kill(self): pass
    def terminate(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass

def run(args, **kw):
    return CompletedProcess(args, 0, b'' if kw.get('capture_output') or kw.get('stdout') == PIPE else None, b'' if kw.get('capture_output') or kw.get('stderr') == PIPE else None)

def call(args, **kw): return 0
def check_call(args, **kw): return 0
def check_output(args, **kw): return b''
def getoutput(cmd): return ''
def getstatusoutput(cmd): return (0, '')

sys.modules[__name__] = sys.modules.get(__name__, sys.modules[__name__])
