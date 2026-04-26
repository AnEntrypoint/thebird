"""thebird shim: psutil — bridges to window.__debug.shell.jobRegistry for
real process listings where available; falls back to harmless defaults."""
from js import window  # type: ignore

class NoSuchProcess(Exception): pass
class AccessDenied(Exception): pass
class TimeoutExpired(Exception): pass

class _NS:
    def __init__(self, **kw): self.__dict__.update(kw)
    def _asdict(self): return dict(self.__dict__)

def _shell():
    try: return window.__debug.shell
    except Exception: return None

def _jobs():
    sh = _shell()
    if sh is None: return []
    try:
        bg = sh.bgJobs
        if bg is None: return []
        return [bg.to_py().get(k) if hasattr(bg, 'to_py') else bg[k] for k in (bg.to_py().keys() if hasattr(bg, 'to_py') else bg.keys())]
    except Exception: return []

class Process:
    def __init__(self, pid=0):
        self.pid = pid
        self._job = None
        for j in _jobs():
            try:
                if (j.id if hasattr(j, 'id') else j.get('id')) == pid: self._job = j; break
            except Exception: pass
    def name(self):
        if self._job:
            try: return str(self._job.cmd if hasattr(self._job, 'cmd') else self._job.get('cmd', 'thebird'))
            except Exception: pass
        return 'thebird'
    def exe(self): return ''
    def cwd(self):
        sh = _shell()
        try: return str(sh.cwd) if sh else '/home'
        except Exception: return '/home'
    def cmdline(self):
        n = self.name()
        return n.split() if n else ['thebird']
    def status(self):
        if self._job:
            try: return str(self._job.status if hasattr(self._job, 'status') else 'running')
            except Exception: pass
        return 'running'
    def create_time(self):
        if self._job:
            try: return float((self._job.startedAt if hasattr(self._job, 'startedAt') else 0)) / 1000.0
            except Exception: pass
        return 0.0
    def cpu_percent(self, interval=None): return 0.0
    def memory_info(self):
        try:
            mem = window.performance.memory if hasattr(window.performance, 'memory') else None
            if mem: return _NS(rss=int(mem.usedJSHeapSize), vms=int(mem.totalJSHeapSize))
        except Exception: pass
        return _NS(rss=0, vms=0)
    def memory_percent(self): return 0.0
    def num_threads(self): return 1
    def is_running(self):
        return self.status() != 'completed'
    def kill(self):
        sh = _shell()
        if sh and self._job:
            try: sh.run(f'kill {self.pid}')
            except Exception: pass
    def terminate(self): self.kill()
    def wait(self, timeout=None): return 0
    def children(self, recursive=False): return []
    def parent(self): return None
    def open_files(self): return []
    def connections(self, kind='inet'): return []
    def environ(self):
        sh = _shell()
        try:
            e = sh.env.to_py() if (sh and hasattr(sh.env, 'to_py')) else {}
            return dict(e) if e else {}
        except Exception: return {}

def cpu_percent(interval=None, percpu=False):
    n = cpu_count()
    return [0.0] * n if percpu else 0.0

def cpu_count(logical=True):
    try: return int(window.navigator.hardwareConcurrency)
    except Exception: return 1

def cpu_times(percpu=False): return _NS(user=0.0, system=0.0, idle=0.0)

def virtual_memory():
    try:
        mem = window.performance.memory if hasattr(window.performance, 'memory') else None
        if mem:
            total = int(mem.jsHeapSizeLimit); used = int(mem.usedJSHeapSize)
            free = max(0, total - used); pct = (used / total * 100) if total else 0
            return _NS(total=total, available=free, used=used, free=free, percent=pct)
    except Exception: pass
    return _NS(total=0, available=0, used=0, free=0, percent=0)

def swap_memory(): return _NS(total=0, used=0, free=0, percent=0)
def disk_usage(path): return _NS(total=0, used=0, free=0, percent=0)
def disk_partitions(all=False): return []
def disk_io_counters(perdisk=False): return _NS(read_count=0, write_count=0)
def net_io_counters(pernic=False): return _NS(bytes_sent=0, bytes_recv=0)
def net_connections(kind='inet'): return []
def boot_time(): return 0.0
def users(): return []

def pids():
    out = []
    for j in _jobs():
        try: out.append(int(j.id if hasattr(j, 'id') else j.get('id', 0)))
        except Exception: pass
    return out or [0]

def pid_exists(pid):
    return pid in pids()

def process_iter(attrs=None, ad_value=None):
    return iter(Process(pid) for pid in pids())
