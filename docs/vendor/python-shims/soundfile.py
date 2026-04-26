"""thebird shim: soundfile — empty audio I/O."""
class SoundFileError(Exception): pass
def read(file, frames=-1, start=0, stop=None, dtype='float64', **kw):
    return ([], 44100)
def write(file, data, samplerate, **kw): pass
def info(file, verbose=False):
    return type('Info', (), dict(samplerate=44100, channels=2, frames=0, duration=0.0))()
def available_formats(): return {}
def available_subtypes(format=None): return {}
class SoundFile:
    def __init__(self, *a, **kw): self.samplerate = 44100; self.channels = 2; self.frames = 0
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def read(self, frames=-1, **kw): return []
    def write(self, data): pass
    def close(self): pass
