"""thebird shim: wave — real WAV reader/writer through IDB-FS open()."""
import struct, io

class Error(Exception): pass

WAVE_FORMAT_PCM = 1

class _WaveBase:
    def __init__(self):
        self._ch = 1; self._sw = 2; self._rate = 44100; self._n = 0; self._raw = b''
    def getnchannels(self): return self._ch
    def setnchannels(self, n): self._ch = int(n)
    def getsampwidth(self): return self._sw
    def setsampwidth(self, w): self._sw = int(w)
    def getframerate(self): return self._rate
    def setframerate(self, r): self._rate = int(r)
    def getnframes(self): return self._n
    def setnframes(self, n): self._n = int(n)
    def getcomptype(self): return 'NONE'
    def getcompname(self): return 'not compressed'
    def setcomptype(self, ct, cn): pass
    def setparams(self, params):
        self._ch, self._sw, self._rate, self._n = params[0], params[1], params[2], params[3]
    def getparams(self): return (self._ch, self._sw, self._rate, self._n, 'NONE', 'not compressed')
    def __enter__(self): return self
    def __exit__(self, *a): self.close()

class _WaveReader(_WaveBase):
    def __init__(self, file):
        super().__init__()
        self._fileobj = file if hasattr(file, 'read') else open(file, 'rb')
        data = self._fileobj.read()
        if len(data) < 44 or data[0:4] != b'RIFF' or data[8:12] != b'WAVE':
            raise Error('not a WAVE file')
        pos = 12
        while pos + 8 <= len(data):
            cid = data[pos:pos+4]; size = struct.unpack('<I', data[pos+4:pos+8])[0]
            body = data[pos+8:pos+8+size]
            if cid == b'fmt ':
                self._ch = struct.unpack('<H', body[2:4])[0]
                self._rate = struct.unpack('<I', body[4:8])[0]
                self._sw = struct.unpack('<H', body[14:16])[0] // 8
            elif cid == b'data':
                self._raw = body
            pos += 8 + size + (size & 1)
        self._n = len(self._raw) // (self._ch * self._sw) if (self._ch * self._sw) else 0
        self._pos = 0
    def readframes(self, n):
        bps = self._ch * self._sw
        out = self._raw[self._pos:self._pos + n * bps]
        self._pos += len(out)
        return out
    def rewind(self): self._pos = 0
    def tell(self): return self._pos // (self._ch * self._sw) if (self._ch * self._sw) else 0
    def setpos(self, n): self._pos = n * (self._ch * self._sw)
    def close(self):
        try: self._fileobj.close()
        except Exception: pass

class _WaveWriter(_WaveBase):
    def __init__(self, file):
        super().__init__()
        self._fileobj = file if hasattr(file, 'write') else open(file, 'wb')
        self._frames = bytearray()
    def writeframes(self, data):
        self._frames.extend(data)
        bps = self._ch * self._sw
        if bps: self._n = len(self._frames) // bps
    def writeframesraw(self, data):
        self._frames.extend(data)
    def close(self):
        # Write RIFF header + fmt chunk + data chunk
        block_align = self._ch * self._sw
        byte_rate = self._rate * block_align
        fmt = b'fmt ' + struct.pack('<IHHIIHH', 16, WAVE_FORMAT_PCM, self._ch, self._rate, byte_rate, block_align, self._sw * 8)
        data_chunk = b'data' + struct.pack('<I', len(self._frames)) + bytes(self._frames)
        riff = b'RIFF' + struct.pack('<I', 4 + len(fmt) + len(data_chunk)) + b'WAVE' + fmt + data_chunk
        try:
            self._fileobj.write(riff)
            self._fileobj.close()
        except Exception: pass

def open(file, mode='rb'):
    if 'r' in mode: return _WaveReader(file)
    if 'w' in mode: return _WaveWriter(file)
    raise Error(f'unsupported mode: {mode}')
