"""thebird Python runtime bootstrap — runs once after Pyodide loads.
Adds shim layer for native-only stdlib modules and a stub-on-missing
finder so unmodified CPython webapps with optional native deps just work."""
import sys
import os
import importlib
import importlib.machinery
import importlib.abc
from types import ModuleType

THEBIRD_SHIM_DIR = '/vendor-shims'
THEBIRD_APP_DIR = '/vendor-apps'

# 1. Make shim dir highest-priority on sys.path so our shims override the
#    Pyodide stubs for subprocess/threading and provide the missing modules.
if THEBIRD_SHIM_DIR not in sys.path:
    sys.path.insert(0, THEBIRD_SHIM_DIR)
if THEBIRD_APP_DIR not in sys.path:
    sys.path.append(THEBIRD_APP_DIR)

# 2. Pre-evict cached real native-only modules (e.g. Pyodide's own subprocess
#    stub) so our shim wins on next import.
for mod in ('subprocess', 'curses'):
    sys.modules.pop(mod, None)

# 3. threading shim — Pyodide's threading.Thread.start raises because
#    _start_new_thread is unsupported. Patch start() to run target() inline
#    so libraries that spawn threads for fire-and-forget work degrade
#    gracefully instead of crashing at import.
try:
    import threading as _t
    _orig_start = _t.Thread.start
    def _safe_start(self):
        try:
            self._started.set()
            self._is_stopped = False
            target = getattr(self, '_target', None)
            args = getattr(self, '_args', ())
            kw = getattr(self, '_kwargs', {})
            if target:
                try: target(*args, **kw)
                except Exception: pass
            self._is_stopped = True
        except Exception: pass
    _t.Thread.start = _safe_start
except Exception:
    pass

# 4. Meta-path finder: when a top-level module isn't found, return a stub
#    so 'import boto3' etc. succeed. Stub raises only on actual attribute
#    access for callable members. Tracks misses so apps can detect.
THEBIRD_STUBBED = set()

class _StubModule(ModuleType):
    def __init__(self, name):
        super().__init__(name)
        self.__file__ = f'<thebird-stub:{name}>'
        self.__path__ = []
        self.__all__ = []
        THEBIRD_STUBBED.add(name)
    def __getattr__(self, item):
        if item.startswith('__') and item.endswith('__'):
            raise AttributeError(item)
        # Return another stub so chained access (mod.Sub.thing) works
        sub = _StubModule(f'{self.__name__}.{item}')
        sys.modules[sub.__name__] = sub
        setattr(self, item, sub)
        return sub
    def __call__(self, *a, **kw):
        return _StubModule(f'{self.__name__}()')

class _StubFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    # Only stub modules that look third-party; never shadow real stdlib.
    _SAFE_PREFIXES = (
        'boto3', 'botocore', 'discord', 'telegram', 'mautrix', 'mcp',
        'slack_sdk', 'slack_bolt', 'mistralai', 'lark_oapi', 'daytona',
        'modal', 'dingtalk_stream', 'alibabacloud', 'nacl', 'kittentts',
        'faster_whisper', 'mem0', 'honcho', 'parallel', 'firecrawl',
        'exa_py', 'fal_client', 'edge_tts', 'elevenlabs', 'tiktoken',
        'acp', 'davey', 'simple_term_menu', 'dotenv', 'croniter',
        'aiohttp_socks', 'qrcode', 'mutagen', 'markdown', 'PIL',
        'numpy', 'websockets', 'tomllib', 'sqlite3',
    )
    def find_spec(self, name, path, target=None):
        head = name.split('.', 1)[0]
        if head not in self._SAFE_PREFIXES: return None
        return importlib.machinery.ModuleSpec(name, self)
    def create_module(self, spec): return _StubModule(spec.name)
    def exec_module(self, module): pass

# Insert AFTER the real importers so real packages still win when present.
sys.meta_path.append(_StubFinder())

# 5. Make ~/.hermes (and similar config dirs) exist so apps that read
#    config don't crash on missing-dir.
for d in ('/home/pyodide/.hermes', '/root/.hermes', '/home/.hermes'):
    try: os.makedirs(d, exist_ok=True)
    except Exception: pass

# 6. Status flag for callers.
sys.modules['__thebird__'] = ModuleType('__thebird__')
sys.modules['__thebird__'].runtime_ready = True
sys.modules['__thebird__'].stubbed = THEBIRD_STUBBED
print(f'[thebird] python runtime ready — shim dir: {THEBIRD_SHIM_DIR}, stub finder active')
