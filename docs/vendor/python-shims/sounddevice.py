"""thebird shim: sounddevice — bridges to Web Audio API for real playback."""
from js import window, Float32Array  # type: ignore
import io

default = type('default', (), {'samplerate': 44100, 'channels': 2, 'device': None})()

class PortAudioError(Exception): pass

_ctx = [None]
def _audio_ctx():
    if _ctx[0] is None:
        try: _ctx[0] = window.AudioContext.new() if hasattr(window, 'AudioContext') else None
        except Exception: _ctx[0] = None
    return _ctx[0]

def _to_float32(data):
    """Convert Python list/array of floats into a JS Float32Array."""
    try:
        if hasattr(data, 'flatten'):
            flat = data.flatten().tolist()
        elif isinstance(data, (list, tuple)) and data and isinstance(data[0], (list, tuple)):
            flat = [v for row in data for v in row]
        else:
            flat = list(data) if not isinstance(data, list) else data
        return Float32Array.new(flat)
    except Exception:
        return None

def play(data, samplerate=None, **kw):
    ctx = _audio_ctx()
    if ctx is None: return
    sr = int(samplerate or default.samplerate)
    arr = _to_float32(data)
    if arr is None: return
    try:
        ch = 1
        if hasattr(data, 'shape') and len(data.shape) > 1: ch = data.shape[1]
        elif isinstance(data, (list, tuple)) and data and isinstance(data[0], (list, tuple)): ch = len(data[0])
        buf = ctx.createBuffer(ch, int(arr.length / ch), sr)
        for c in range(ch):
            channel = buf.getChannelData(c)
            # Interleave-deinterleave for multi-channel
            for i in range(int(arr.length / ch)):
                channel[i] = arr[i * ch + c] if ch > 1 else arr[i]
        src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start()
    except Exception: pass

def stop():
    ctx = _audio_ctx()
    if ctx:
        try: ctx.suspend()
        except Exception: pass

def wait(): pass

def rec(frames, samplerate=None, channels=2, **kw):
    return [[0.0] * channels for _ in range(frames)]

def query_devices():
    ctx = _audio_ctx()
    if ctx is None: return []
    return [{'name': 'WebAudio', 'max_input_channels': 0, 'max_output_channels': 2, 'default_samplerate': float(ctx.sampleRate) if hasattr(ctx, 'sampleRate') else 44100.0}]

class InputStream:
    def __init__(self, *a, **kw): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def start(self): pass
    def stop(self): pass
    def close(self): pass
    def read(self, frames): return ([], False)

class OutputStream:
    def __init__(self, samplerate=None, channels=2, **kw):
        self.samplerate = samplerate or 44100; self.channels = channels
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def start(self): pass
    def stop(self): pass
    def close(self): pass
    def write(self, data):
        play(data, samplerate=self.samplerate, channels=self.channels)

class Stream(InputStream): pass
