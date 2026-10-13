#!/usr/bin/env python3
"""How well a built wedgie's Trust M wires work. Over USB, no tools, no firmware change.
Hammers the chip (read the certificate, SHA-256 1 KB, 32 random bytes; never a signature, which would
trip its security-event slowdown) at each I2C speed, and checks every answer against the first / the
right one. Counts what trustm.py's retries normally hide: every NACKed try on the wires.
Wiggle, tap and squeeze the wedgie while it runs: a bad joint shows up as retries or errors.
    uv run --with pyserial python3 tools/trustmsoak.py [--seconds 60] [--freq 100000,400000,1000000] [--id A1B2C3]
Press A on the wedgie to let it in. It restarts into its app at the end."""
import argparse, importlib.util, os, sys, time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("wedgie", os.path.join(here, "..", "public", "wedgie.py"))
W = importlib.util.module_from_spec(spec)
spec.loader.exec_module(W)

ap = argparse.ArgumentParser()
ap.add_argument("--seconds", type=int, default=60, help="per speed")
ap.add_argument("--freq", default="100000,400000,1000000")
ap.add_argument("--port")
ap.add_argument("--id")
a = ap.parse_args()
a.name = None

# On the wedgie. _w/_r are trustm._write/_read with a counter on every failed try.
SOAK = """
import time, hashlib, optiga, trustm as T
_m = [0]
def _w(d):
    for _ in range(200):
        try:
            T.i2c.writeto(0x30, d); time.sleep_us(100); return
        except OSError:
            _m[0] += 1; time.sleep_ms(1)
    raise OSError("write not acked")
def _r(n):
    for _ in range(200):
        try:
            r = T.i2c.readfrom(0x30, n); time.sleep_us(100); return r
        except OSError:
            _m[0] += 1; time.sleep_ms(1)
    raise OSError("read not acked")
T._write, T._read = _w, _r
_blk = bytes(range(256)) * 4
_want = hashlib.sha256(_blk).digest()
def _open(f):
    c = optiga.Chip()
    T.bus(4, 5, f)
    return c
def soak(f, secs):
    c = _open(f)
    cert = c.read(optiga.CERT)
    ops = err = bad = 0
    last = ""
    _m[0] = 0
    t0 = tl = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t0) < secs * 1000:
        try:
            k = ops % 3
            if k == 0:
                ok = c.read(optiga.CERT) == cert
            elif k == 1:
                ok = c.sha256(_blk) == _want
            else:
                ok = len(c.random(32)) == 32
            ops += 1
            bad += not ok
        except Exception as e:
            err += 1
            last = str(e)[:50]
            try:
                c = _open(f)
            except Exception:
                pass
        if time.ticks_diff(time.ticks_ms(), tl) >= 5000:
            tl = time.ticks_ms()
            print("P", f, ops, _m[0], err, bad, last)
    print("R", f, ops, _m[0], err, bad, last)
"""


def line(f, ops, miss, err, bad, last=""):
    return "%5d kHz  %6d ops  %5d retries  %3d errors  %3d wrong%s" % (
        f // 1000, ops, miss, err, bad, ("  (" + last + ")") if last else "")


def run(wg, f):
    """soak(f) on the wedgie, a line every 5 s, the totals back."""
    wg.s.write(("soak(%d, %d)" % (f, a.seconds)).encode() + b"\x04")
    wg._read_until(b"OK", 5)
    buf, end = wg.buf, time.time() + a.seconds + 120
    wg.buf = b""
    while True:
        while b"\n" in buf:
            ln, buf = buf.split(b"\n", 1)
            p = ln.decode("utf8", "replace").strip().split(" ", 6)
            if p[0] in ("P", "R"):
                v = [int(x) for x in p[1:6]] + [p[6] if len(p) > 6 else ""]
                print(("  " if p[0] == "P" else "= ") + line(*v), flush=True)
                if p[0] == "R":
                    wg.buf = buf
                    wg._read_until(b"\x04", 5)
                    wg._read_until(b"\x04", 5)
                    return v
        if b"\x04" in buf:      # it raised before the totals
            wg.buf = buf.split(b"\x04", 1)[1]
            err = wg._read_until(b"\x04", 5).decode("utf8", "replace").strip()
            sys.exit("the wedgie said: " + (err.splitlines()[-1] if err else "?"))
        if time.time() > end:
            sys.exit("no answer from the wedgie")
        buf += wg.s.read(256)


wg = W.pick(a)
wg.enter()
results = []
try:
    wg.exec(SOAK, 20)
    for f in [int(x) for x in a.freq.split(",")]:
        print("%d kHz, %d s. Wiggle it now." % (f // 1000, a.seconds), flush=True)
        results.append(run(wg, f))
except KeyboardInterrupt:
    wg.s.write(b"\x03")
finally:
    wg.leave()

print()
for f, ops, miss, err, bad, last in results:
    verdict = "FAIL" if err or bad or not ops else ("retries" if miss else "clean")
    print("%-7s %s" % (verdict, line(f, ops, miss, err, bad)))
