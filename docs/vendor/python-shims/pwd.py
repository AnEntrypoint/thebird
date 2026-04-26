"""thebird shim: pwd — single fake user."""
from collections import namedtuple
struct_passwd = namedtuple('struct_passwd', 'pw_name pw_passwd pw_uid pw_gid pw_gecos pw_dir pw_shell')
_USER = struct_passwd('thebird', 'x', 1000, 1000, 'thebird user', '/home', '/bin/sh')
def getpwall(): return [_USER]
def getpwnam(name): return _USER
def getpwuid(uid): return _USER
