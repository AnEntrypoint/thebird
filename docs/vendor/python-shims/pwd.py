"""thebird shim: pwd — user identity from thebird GitHub login or default."""
from collections import namedtuple
from js import window  # type: ignore

struct_passwd = namedtuple('struct_passwd', 'pw_name pw_passwd pw_uid pw_gid pw_gecos pw_dir pw_shell')

def _user():
    try:
        u = window.localStorage.getItem('thebird_github_user')
        if u: return str(u)
    except Exception: pass
    return 'thebird'

def _home():
    try:
        sh = window.__debug.shell
        if sh and hasattr(sh, 'cwd'): pass
    except Exception: pass
    return '/home'

def _entry():
    name = _user()
    return struct_passwd(name, 'x', 1000, 1000, name, _home(), '/bin/sh')

def getpwall(): return [_entry()]
def getpwnam(name): return _entry()
def getpwuid(uid): return _entry()
