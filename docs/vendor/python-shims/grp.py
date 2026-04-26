"""thebird shim: grp — single fake group."""
from collections import namedtuple
struct_group = namedtuple('struct_group', 'gr_name gr_passwd gr_gid gr_mem')
_GRP = struct_group('thebird', 'x', 1000, ['thebird'])
def getgrall(): return [_GRP]
def getgrnam(name): return _GRP
def getgrgid(gid): return _GRP
