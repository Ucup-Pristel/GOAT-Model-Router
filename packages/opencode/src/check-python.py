"""Private Linux verifier. No user code runs before the kernel filter loads."""
import ctypes
import errno
import json
import os
import resource
import socket
import sys

request = json.load(sys.stdin)
lib = ctypes.CDLL("libseccomp.so.2")
project = isinstance(request, dict) and "suite" in request
if project:
    import importlib.util
    import io
    import unittest
    import sysconfig

    # Only two read-only trees: a newly provisioned snapshot and the trusted
    # system Python library. No inherited cwd, project plugins, site or HOME.
    if os.uname().machine not in ("x86_64", "aarch64"):
        raise RuntimeError("Unsupported Landlock syscall architecture")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.syscall(444, 0, 0, 1) < 3:
        raise RuntimeError("Landlock ABI 3 required")
    rights = ctypes.c_uint64((1 << 15) - 1)
    rules = libc.syscall(444, ctypes.byref(rights), 8, 0)
    class PathRule(ctypes.Structure):
        _fields_ = [("access", ctypes.c_uint64), ("fd", ctypes.c_int32)]
    for tree in (os.getcwd(), sysconfig.get_path("stdlib")):
        fd = os.open(tree, os.O_PATH | os.O_DIRECTORY)
        rule = PathRule((1 << 2) | (1 << 3), fd)
        if libc.syscall(445, rules, 1, ctypes.byref(rule), 0) != 0:
            raise RuntimeError("Cannot bind read-only test trees")
        os.close(fd)
    if libc.prctl(38, 1, 0, 0, 0) or libc.syscall(446, rules, 0):
        raise RuntimeError("Cannot restrict test process")
    os.close(rules)
os.closerange(3, 1048576)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_AS, (96 << 20, 96 << 20))
resource.setrlimit(resource.RLIMIT_CPU, (1, 1))
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
flt = lib.seccomp_init(0x00050000 | errno.EPERM)
if not flt:
    raise RuntimeError("seccomp unavailable")
calls = [b"write", b"exit", b"exit_group", b"brk", b"mmap", b"munmap",
         b"mremap", b"mprotect", b"rt_sigreturn", b"clock_gettime"]
if project:
    calls += [b"openat", b"read", b"close", b"lseek", b"getdents64", b"getcwd",
              b"newfstatat", b"fstat", b"getrandom", b"fcntl"]
for name in calls:
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
elif project:
    # Every project invocation probes both layers before importing any source.
    try:
        os.open(".goat-write-probe", os.O_CREAT | os.O_WRONLY, 0o600)
    except PermissionError:
        pass
    else:
        raise RuntimeError("workspace unexpectedly writable")
    if not request["suite"]:
        reply = "isolated"
    else:
        sys.path.insert(0, os.getcwd())
        name = request["suite"]
        spec = importlib.util.spec_from_file_location(name, os.path.join(os.getcwd(), *name.split(".")) + ".py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
        result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
        reply = {"count": result.testsRun, "passed": result.wasSuccessful() and result.testsRun > 0 and
                 not result.skipped and not result.expectedFailures,
                 "failures": [str(case) for case, _ in result.failures + result.errors]}
else:
    scope = {}
    exec(compile(request["source"], "<workspace>", "exec"), scope)
    reply = scope[request["function"]](*request["args"])
os.write(1, json.dumps(reply, allow_nan=False).encode())
os._exit(0)
