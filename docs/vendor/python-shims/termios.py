"""thebird shim: termios — terminal IOCTL no-ops."""
TCSANOW = 0; TCSADRAIN = 1; TCSAFLUSH = 2
TCIFLUSH = 0; TCOFLUSH = 1; TCIOFLUSH = 2
TCOOFF = 0; TCOON = 1; TCIOFF = 2; TCION = 3
ICANON = 2; ECHO = 8; ISIG = 1
class error(Exception): pass
def tcgetattr(fd): return [0,0,0,0,0,0,[0]*32]
def tcsetattr(fd, when, attr): return None
def tcsendbreak(fd, duration): return None
def tcdrain(fd): return None
def tcflush(fd, queue): return None
def tcflow(fd, action): return None
