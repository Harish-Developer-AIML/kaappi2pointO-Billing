"""Download Termux packages (and their dependencies) for one Android ABI and
unpack them. Usage: python3 -I termux_fetch.py <Packages-index> <arch> <outdir> <pkg> [<pkg> ...]
Each .deb is unpacked (ar → data.tar.xz → tar) into <outdir>/root/."""
import os
import re
import subprocess
import sys
import urllib.request

index, arch, out, *wanted = sys.argv[1:]
BASE = "https://packages.termux.dev/apt/termux-main/"

pkgs = {}
for block in open(index, encoding="utf-8").read().split("\n\n"):
    fields = {}
    for line in block.splitlines():
        if ": " in line and not line.startswith(" "):
            k, v = line.split(": ", 1)
            fields[k] = v
    if "Package" in fields:
        pkgs[fields["Package"]] = fields

def deps_of(name):
    d = pkgs[name].get("Depends", "") + ", " + pkgs[name].get("Pre-Depends", "")
    result = []
    for part in d.split(","):
        part = part.strip()
        if not part:
            continue
        alt = [re.sub(r"\s*\(.*?\)", "", a).strip() for a in part.split("|")]
        result.append(next((a for a in alt if a in pkgs), alt[0]))
    return result

seen, order, stack = set(), [], list(wanted)
while stack:
    n = stack.pop()
    if n in seen:
        continue
    seen.add(n)
    if n not in pkgs:
        print("  ! not in index:", n)
        continue
    order.append(n)
    stack.extend(deps_of(n))

os.makedirs(os.path.join(out, "debs"), exist_ok=True)
root = os.path.join(out, "root")
os.makedirs(root, exist_ok=True)
for n in sorted(order):
    f = pkgs[n]["Filename"]
    deb = os.path.join(out, "debs", os.path.basename(f))
    if not os.path.exists(deb):
        urllib.request.urlretrieve(BASE + f, deb)
    work = deb + ".x"
    os.makedirs(work, exist_ok=True)
    # .deb = GNU ar archive; macOS's BSD ar can't read GNU names ("name/"), so parse it here.
    raw = open(deb, "rb").read()
    assert raw[:8] == b"!<arch>\n", deb
    pos = 8
    data = None
    while pos + 60 <= len(raw):
        hdr = raw[pos:pos + 60]
        member = hdr[:16].decode().strip().rstrip("/")
        size = int(hdr[48:58].decode().strip())
        body = raw[pos + 60:pos + 60 + size]
        if member.startswith("data.tar"):
            data = os.path.join(work, member)
            open(data, "wb").write(body)
        pos += 60 + size + (size % 2)
    subprocess.run(["tar", "-xf", data, "-C", root], check=True)
    print(f"  {n} {pkgs[n]['Version']}")
print(f"{len(order)} packages unpacked into {root}")
