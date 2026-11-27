"""Commit one approved byte image on Linux. Never truncate before comparison.

A write lease excludes other open readers/writers while we compare and write
the pinned inode. A concurrent rename cannot redirect that fd to its replacement.
"""
import errno
import fcntl
import json
import os
import signal
import stat
import sys


def commit(req, result):
    root, path = req["root"], req["path"]
    dirs = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parent = os.open("/", dirs)
    before = req["before"]
    after = req["after"].encode()
    root_parts = root.strip("/").split("/")
    parts = path.split("/")
    if not root.startswith("/") or any(p in ("", ".", "..") for p in root_parts + parts):
        raise ValueError("Invalid workspace path")
    for i, part in enumerate(root_parts + parts[:-1]):
        try:
            child = os.open(part, dirs, dir_fd=parent)
        except FileNotFoundError:
            if before is not None or i < len(root_parts):
                raise
            os.mkdir(part, 0o700, dir_fd=parent)
            result["directories"].append("/".join(parts[:i-len(root_parts)+1]))
            child = os.open(part, dirs, dir_fd=parent)
        os.close(parent)
        parent = child
    name = parts[-1]
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
    target = os.path.join(root, path)
    if before is None:
        # Publish a fully written inode only if the name is still absent.
        fd = os.open(".", os.O_TMPFILE | os.O_RDWR, 0o600, dir_fd=parent)
        if os.write(fd, after) != len(after):
            raise OSError("Short staging write")
        os.fsync(fd)
        if os.readlink(f"/proc/self/fd/{parent}") != os.path.dirname(target):
            raise ValueError("Destination directory moved")
        os.link(f"/proc/self/fd/{fd}", name, dst_dir_fd=parent, follow_symlinks=True)
        result.update(status="written", touched=True)
        return
    fd = os.open(name, flags, dir_fd=parent)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Target is no longer a single regular file")
    signal.signal(signal.SIGIO, signal.SIG_IGN)
    fcntl.fcntl(fd, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    expected = before.encode()
    if os.pread(fd, len(expected)+1, 0) != expected:
        raise ValueError("Source bytes changed")
    if os.readlink(f"/proc/self/fd/{fd}") != target or os.fstat(fd).st_nlink != 1:
        raise ValueError("Target moved or linked")
    if fcntl.fcntl(fd, fcntl.F_GETLEASE) != fcntl.F_WRLCK:
        raise ValueError("Another process requested the file")
    result["touched"] = True
    if os.pwrite(fd, after, 0) != len(after):
        raise OSError("Short workspace write")
    os.ftruncate(fd, len(after))
    os.fsync(fd)
    if os.pread(fd, len(after)+1, 0) != after:
        raise OSError("Workspace byte verification failed")
    if os.readlink(f"/proc/self/fd/{fd}") != target:
        raise ValueError("Target moved during application")
    result["status"] = "written"


result = {"status": "failed", "touched": False, "directories": []}
try:
    commit(json.load(sys.stdin), result)
except (OSError, ValueError) as error:
    if isinstance(error, ValueError) or getattr(error, "errno", None) in (
        errno.ENOENT, errno.EEXIST, errno.EAGAIN, errno.ELOOP, errno.ENOTDIR
    ):
        result["status"] = "conflict"
    result["error"] = str(error)
print(json.dumps(result))
