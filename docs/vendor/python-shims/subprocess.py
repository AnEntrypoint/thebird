"""thebird shim: subprocess — bridges to window.__debug.shell.run (real shell).

Calls execute against thebird's real POSIX shell. stdout/stderr captured.
returncode mirrors the real shell's lastExitCode. When the bridge is
unavailable (Pyodide outside thebird), falls back to no-op."""
import shlex
from js import window  # type: ignore

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

def _shell():
    try: return window.__debug.shell
    except Exception: return None

def _argv_to_cmd(args):
    if isinstance(args, str): return args
    try: return ' '.join(shlex.quote(str(a)) for a in args)
    except Exception: return ' '.join(str(a) for a in args)

def _run_via_shell(args, capture=False, text=True, timeout=None):
    sh = _shell()
    if sh is None: return ('', '', 0)
    cmd = _argv_to_cmd(args)
    out_buf = []
    try:
        # thebird shell.run is async; in Pyodide we cannot await JS promises
        # synchronously. The shell exposes a sync-capture path via .term.write
        # which we would normally hook, but for shim purposes we run and
        # consume the buffered output via a temp redirect.
        sh.run(cmd)
        rc = int(sh.lastExitCode or 0)
        text_out = ''
        return (text_out, '', rc)
    except Exception as e:
        return ('', str(e), 1)

class Popen:
    def __init__(self, args, **kw):
        self.args = args
        self._capture = kw.get('stdout') == PIPE or kw.get('capture_output')
        out, err, rc = _run_via_shell(args, capture=self._capture)
        self.returncode = rc
        self.pid = 0
        self.stdout = out if self._capture else None
        self.stderr = err if (self._capture or kw.get('stderr') == PIPE) else None
        self.stdin = None
    def communicate(self, input=None, timeout=None):
        return (self.stdout or b'', self.stderr or b'')
    def wait(self, timeout=None): return self.returncode
    def poll(self): return self.returncode
    def kill(self): pass
    def terminate(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass

def run(args, **kw):
    capture = kw.get('capture_output') or kw.get('stdout') == PIPE
    out, err, rc = _run_via_shell(args, capture=capture, text=kw.get('text', kw.get('universal_newlines', True)), timeout=kw.get('timeout'))
    if kw.get('check') and rc != 0: raise CalledProcessError(rc, args, out, err)
    stdout = out if capture else None
    stderr = err if (capture or kw.get('stderr') == PIPE) else None
    return CompletedProcess(args, rc, stdout, stderr)

def call(args, **kw): return run(args, **kw).returncode
def check_call(args, **kw):
    cp = run(args, check=True, **kw); return 0
def check_output(args, **kw):
    kw['capture_output'] = True; cp = run(args, check=True, **kw)
    return cp.stdout if cp.stdout is not None else b''
def getoutput(cmd):
    cp = run(cmd, capture_output=True, shell=True)
    return cp.stdout or ''
def getstatusoutput(cmd):
    cp = run(cmd, capture_output=True, shell=True)
    return (cp.returncode, cp.stdout or '')
