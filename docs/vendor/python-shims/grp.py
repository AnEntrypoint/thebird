"""thebird shim: grp — group identity from thebird user."""
from collections import namedtuple
from js import window  # type: ignore

struct_group = namedtuple('struct_group', 'gr_name gr_passwd gr_gid gr_mem')

def _name():
    try:
        u = window.localStorage.getItem('thebird_github_user')
        if u: return str(u)
    except Exception: pass
    return 'thebird'

def _entry():
    n = _name(); return struct_group(n, 'x', 1000, [n])

def getgrall(): return [_entry()]
def getgrnam(name): return _entry()
def getgrgid(gid): return _entry()
