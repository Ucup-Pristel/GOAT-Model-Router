"""Private Linux verifier. No user code runs before the kernel filter loads."""
import ctypes
import errno
import json
import os
import resource
import socket
import sys

request = json.load(sys.stdin)
os.closerange(3, 1048576)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_AS, (96 << 20, 96 << 20))
resource.setrlimit(resource.RLIMIT_CPU, (1, 1))
lib = ctypes.CDLL("libseccomp.so.2")
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
flt = lib.seccomp_init(0x00050000 | errno.EPERM)
if not flt:
    raise RuntimeError("seccomp unavailable")
for name in (b"write", b"exit", b"exit_group", b"brk", b"mmap", b"munmap",
             b"mremap", b"mprotect", b"rt_sigreturn", b"clock_gettime"):
    nr = lib.seccomp_syscall_resolve_name(name)
    if nr < 0 or lib.seccomp_rule_add(flt, 0x7fff0000, nr, 0) != 0:
        raise RuntimeError("seccomp rule unavailable")
if lib.seccomp_load(flt) != 0:
    raise RuntimeError("seccomp load failed")
for probe in (lambda: os.open("/dev/null", os.O_RDONLY), socket.socket):
    try:
        probe()
    except PermissionError:
        continue
    raise RuntimeError("isolation probe unexpectedly permitted")
if request == "probe":
    reply = "isolated"
else:
    scope = {}
    exec(compile(request["source"], "<workspace>", "exec"), scope)
    reply = scope[request["function"]](*request["args"])
os.write(1, json.dumps(reply, allow_nan=False).encode())
os._exit(0)
