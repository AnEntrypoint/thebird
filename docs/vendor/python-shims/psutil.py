"""thebird shim: psutil — process info returns harmless zeros."""
class NoSuchProcess(Exception): pass
class AccessDenied(Exception): pass
class TimeoutExpired(Exception): pass

class _NS:
    def __init__(self, **kw): self.__dict__.update(kw)
    def _asdict(self): return dict(self.__dict__)

class Process:
    def __init__(self, pid=0): self.pid = pid
    def name(self): return 'thebird'
    def exe(self): return ''
    def cwd(self): return '/home'
    def cmdline(self): return ['thebird']
    def status(self): return 'running'
    def create_time(self): return 0.0
    def cpu_percent(self, interval=None): return 0.0
    def memory_info(self): return _NS(rss=0, vms=0)
    def memory_percent(self): return 0.0
    def num_threads(self): return 1
    def is_running(self): return True
    def kill(self): pass
    def terminate(self): pass
    def wait(self, timeout=None): return 0
    def children(self, recursive=False): return []
    def parent(self): return None
    def open_files(self): return []
    def connections(self, kind='inet'): return []
    def environ(self): return {}

def cpu_percent(interval=None, percpu=False): return 0.0 if not percpu else [0.0]
def cpu_count(logical=True): return 1
def cpu_times(percpu=False): return _NS(user=0, system=0, idle=0)
def virtual_memory(): return _NS(total=0, available=0, percent=0, used=0, free=0)
def swap_memory(): return _NS(total=0, used=0, free=0, percent=0)
def disk_usage(path): return _NS(total=0, used=0, free=0, percent=0)
def disk_partitions(all=False): return []
def disk_io_counters(perdisk=False): return _NS(read_count=0, write_count=0)
def net_io_counters(pernic=False): return _NS(bytes_sent=0, bytes_recv=0)
def net_connections(kind='inet'): return []
def boot_time(): return 0.0
def users(): return []
def pids(): return [0]
def pid_exists(pid): return False
def process_iter(attrs=None, ad_value=None): return iter([])
