"""Trusted launcher: verify actual cgroup controls before any project code."""
import os
import sys

with open("/proc/self/cgroup", encoding="ascii") as stream:
    group = next((line.strip()[3:] for line in stream if line.startswith("0::")), None)
if group is None or not group.startswith("/") or ".." in group.split("/"):
    raise RuntimeError("Unified resource controls unavailable")
root = "/sys/fs/cgroup" + group
for name, maximum in (("memory.max", 512 << 20), ("memory.swap.max", 0), ("pids.max", 32)):
    with open(root + "/" + name, encoding="ascii") as stream:
        value = stream.read().strip()
    if not value.isdecimal() or int(value) > maximum:
        raise RuntimeError("Required resource limit unavailable")
if len(sys.argv) < 2 or sys.argv[1] != "/usr/bin/bwrap":
    raise RuntimeError("Invalid isolated launcher")
os.execv(sys.argv[1], sys.argv[1:])
