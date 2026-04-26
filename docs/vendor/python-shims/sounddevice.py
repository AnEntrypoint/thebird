"""thebird shim: sounddevice — no audio."""
default = type('default', (), {'samplerate': 44100, 'channels': 2, 'device': None})()
def play(data, samplerate=None, **kw): pass
def stop(): pass
def wait(): pass
def rec(frames, samplerate=None, channels=2, **kw):
    return [[0.0] * channels for _ in range(frames)]
def query_devices(): return []
class PortAudioError(Exception): pass
class InputStream:
    def __init__(self, *a, **kw): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def start(self): pass
    def stop(self): pass
    def close(self): pass
    def read(self, frames): return ([], False)
class OutputStream:
    def __init__(self, *a, **kw): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def start(self): pass
    def stop(self): pass
    def close(self): pass
    def write(self, data): pass
class Stream(InputStream): pass
