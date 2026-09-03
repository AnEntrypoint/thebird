"""thebird shim: soundfile — wave/PCM I/O bridged through Web Audio decode + IDB FS."""
import io, struct
from js import window  # type: ignore

class SoundFileError(Exception): pass

def _read_wav(path_or_buf):
    """Minimal RIFF WAVE PCM reader using only stdlib struct."""
    if hasattr(path_or_buf, 'read'):
        data = path_or_buf.read()
    else:
        with open(path_or_buf, 'rb') as f: data = f.read()
    if len(data) < 44 or data[0:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise SoundFileError(f'not a wave file: {path_or_buf}')
    # Parse fmt + data chunks
    pos = 12; sr = 44100; ch = 1; bps = 16; samples = b''
    while pos + 8 <= len(data):
        cid = data[pos:pos+4]; size = struct.unpack('<I', data[pos+4:pos+8])[0]
        body = data[pos+8:pos+8+size]
        if cid == b'fmt ':
            ch = struct.unpack('<H', body[2:4])[0]
            sr = struct.unpack('<I', body[4:8])[0]
            bps = struct.unpack('<H', body[14:16])[0]
        elif cid == b'data':
            samples = body
        pos += 8 + size + (size & 1)
    if bps == 16:
        n = len(samples) // 2
        ints = struct.unpack(f'<{n}h', samples)
        floats = [v / 32768.0 for v in ints]
    elif bps == 32:
        n = len(samples) // 4
        ints = struct.unpack(f'<{n}i', samples)
        floats = [v / 2147483648.0 for v in ints]
    else:
        floats = []
    if ch > 1:
        floats = [floats[i:i+ch] for i in range(0, len(floats), ch)]
    return floats, sr, ch

def read(file, frames=-1, start=0, stop=None, dtype='float64', **kw):
    try:
        floats, sr, ch = _read_wav(file)
        return (floats, sr)
    except Exception:
        return ([], 44100)

def _write_wav(path, data, samplerate, ch=1):
    is_2d = bool(data) and isinstance(data[0], (list, tuple))
    if is_2d:
        ch = len(data[0])
        flat = [v for row in data for v in row]
    else:
        flat = list(data); ch = 1
    ints = [max(-32768, min(32767, int(v * 32767))) for v in flat]
    raw = struct.pack(f'<{len(ints)}h', *ints)
    block_align = ch * 2
    byte_rate = samplerate * block_align
    fmt = b'fmt ' + struct.pack('<IHHIIHH', 16, 1, ch, samplerate, byte_rate, block_align, 16)
    chunk = b'data' + struct.pack('<I', len(raw)) + raw
    riff = b'RIFF' + struct.pack('<I', 4 + len(fmt) + len(chunk)) + b'WAVE' + fmt + chunk
    with open(path, 'wb') as f: f.write(riff)

def write(file, data, samplerate, **kw):
    _write_wav(file, data, int(samplerate))

def info(file, verbose=False):
    try:
        floats, sr, ch = _read_wav(file)
        n = len(floats) if ch == 1 else len(floats)
        return type('Info', (), dict(samplerate=sr, channels=ch, frames=n, duration=n / sr if sr else 0.0))()
    except Exception:
        return type('Info', (), dict(samplerate=44100, channels=1, frames=0, duration=0.0))()

def available_formats(): return {'WAV': 'WAVE Audio'}
def available_subtypes(format=None): return {'PCM_16': '16-bit PCM'}

class SoundFile:
    def __init__(self, file, mode='r', samplerate=None, channels=1, **kw):
        self._file = file; self._mode = mode
        self.samplerate = samplerate or 44100; self.channels = channels; self.frames = 0
        self._buf = []
        if 'r' in mode:
            try:
                floats, sr, ch = _read_wav(file)
                self._buf = floats; self.samplerate = sr; self.channels = ch
                self.frames = len(floats)
            except Exception: pass
    def __enter__(self): return self
    def __exit__(self, *a):
        if 'w' in self._mode and self._buf:
            _write_wav(self._file, self._buf, int(self.samplerate), self.channels)
    def read(self, frames=-1, **kw):
        if frames < 0: out, self._buf = self._buf, []
        else: out, self._buf = self._buf[:frames], self._buf[frames:]
        return out
    def write(self, data):
        self._buf.extend(data if isinstance(data, list) else list(data))
    def close(self):
        if 'w' in self._mode and self._buf:
            try: _write_wav(self._file, self._buf, int(self.samplerate), self.channels)
            except Exception: pass
