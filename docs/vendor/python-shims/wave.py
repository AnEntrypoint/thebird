"""thebird shim: wave — minimal WAV reader/writer that doesn't crash."""
class Error(Exception): pass
WAVE_FORMAT_PCM = 1
class _Wave:
    def __init__(self): self._n = 0; self._rate = 44100; self._ch = 1; self._sw = 2
    def getnchannels(self): return self._ch
    def setnchannels(self, n): self._ch = n
    def getframerate(self): return self._rate
    def setframerate(self, r): self._rate = r
    def getsampwidth(self): return self._sw
    def setsampwidth(self, w): self._sw = w
    def getnframes(self): return self._n
    def setnframes(self, n): self._n = n
    def readframes(self, n): return b''
    def writeframes(self, data): self._n += len(data) // (self._ch * self._sw)
    def writeframesraw(self, data): self.writeframes(data)
    def close(self): pass
    def setparams(self, params): pass
    def getparams(self): return (self._ch, self._sw, self._rate, self._n, 'NONE', 'not compressed')
    def __enter__(self): return self
    def __exit__(self, *a): pass
def open(file, mode='rb'): return _Wave()
