# wedgie.dev/test on the device: what board this is, then the guided button run on its own screen.
# Runs after probe.py (uses its _LCD, col, _big, KEYS, out). "@<tag> <json>" lines, like probe.py.

_ORDER = ("up", "down", "left", "right", "press", "A", "B", "X", "Y")
_NAME = {"up": "UP", "down": "DOWN", "left": "LEFT", "right": "RIGHT", "press": "IN", "A": "A", "B": "B", "X": "X", "Y": "Y"}
_COLOR = {"up": (255, 0, 0), "down": (0, 255, 0), "left": (0, 0, 255), "right": (255, 255, 255), "press": (0, 0, 0),
          "A": (255, 220, 0), "B": (0, 230, 230), "X": (230, 0, 230), "Y": (128, 128, 128)}
_INK, _PAPER, _GREEN, _RED = (26, 27, 26), (255, 255, 255), (34, 196, 82), (227, 49, 44)


# --- which board ---------------------------------------------------------
def _vbus():
    """A real Pico / Pico 2 senses USB power on GP24. (On a Pico W that pin is the WiFi chip's.)"""
    p = Pin(24, Pin.IN, Pin.PULL_DOWN)
    time.sleep_ms(2)
    v = p.value()
    Pin(24, Pin.IN)
    return v


def _cyw43():
    """Is the Pico W's WiFi chip there? Power it (WL_ON GP23) and read its gSPI test register
    (0xFEEDBEAD) by hand: CS GP25, clock GP29, data GP24. Word order and clock edge are tried
    every way, since only 'it answered' matters here."""
    on, cs, clk = Pin(23, Pin.OUT, value=0), Pin(25, Pin.OUT, value=1), Pin(29, Pin.OUT, value=0)
    time.sleep_ms(20)
    on(1)
    time.sleep_ms(250)
    pats = (0xFEEDBEAD, 0xBEADFEED, 0xADBEEDFE, 0xEDFEADBE)
    found = False
    for cmd in (0x4000A004, 0xA0044000):          # read, bus function, address 0x14, 4 bytes
        for _ in range(3):
            d = Pin(24, Pin.OUT, value=0)
            cs(0)
            for i in range(31, -1, -1):
                d((cmd >> i) & 1)
                clk(1)
                clk(0)
            d = Pin(24, Pin.IN)
            hi = lo = 0
            for _ in range(64):
                clk(1)
                hi = (hi << 1) | d.value()
                clk(0)
                lo = (lo << 1) | d.value()
            cs(1)
            for v in (hi, lo):
                for s in range(33):
                    if ((v >> s) & 0xFFFFFFFF) in pats:
                        found = True
            if found:
                break
            time.sleep_ms(10)
        if found:
            break
    on(0)
    for p in (23, 24, 25, 29):
        Pin(p, Pin.IN)
    return found


def board():
    gc.collect()
    m = sys.implementation._machine
    fs = os.statvfs("/")
    d = {"machine": m, "cpu": "RP2350" if "RP2350" in m else "RP2040" if "RP2040" in m else "?",
         "uid": machine.unique_id().hex(), "mp": os.uname().release, "mhz": machine.freq() // 1_000_000,
         "heap": gc.mem_free() + gc.mem_alloc(), "fs": fs[0] * fs[2], "wbuild": False, "wifi": False}
    try:
        import network
        d["wbuild"] = True
    except ImportError:
        pass
    if d["wbuild"]:
        try:
            w = network.WLAN(network.STA_IF)
            w.active(True)
            d["mac"] = ":".join("%02x" % b for b in w.config("mac"))
            w.active(False)
            d["wifi"] = True
        except Exception as e:
            d["wifiError"] = str(e) or type(e).__name__
    else:
        d["vbus"] = _vbus()
        d["wifi"] = not d["vbus"] and _cyw43()
    out("board", d)


# --- the screen ------------------------------------------------------------
# Drawn with one reused 3 KB stripe buffer and a line at a time, never a whole-screen allocation:
# with the firmware loaded an RP2040 has ~25 KB free, and a draw that has to hunt for memory stalls
# long enough to miss a quick button tap. /test's Test only runs over the loaded firmware and its cut-up
# heap: an 11 KB stripe failed there ("allocating 11520"; 2026-10-14).
_row = None


def _fill(c):
    global _row
    if _row is None:
        _row = bytearray(240 * 6 * 2)
    framebuf.FrameBuffer(_row, 240, 6, framebuf.RGB565).fill(c)
    for y in range(0, 240, 6):
        _lcd.blit(0, y, 240, 6, _row)


def _text(s, scale, y, f, b):
    w = 8 * len(s)
    mono = bytearray((w + 7) // 8 * 8)
    m = framebuf.FrameBuffer(mono, w, 8, framebuf.MONO_HLSB)
    m.text(s, 0, 0, 1)
    fg, bg = bytes((f & 0xFF, f >> 8)) * scale, bytes((b & 0xFF, b >> 8)) * scale
    x0 = (240 - w * scale) // 2
    for r in range(8):
        line = b"".join(fg if m.pixel(x, r) else bg for x in range(w))
        _lcd.blit(x0, y + r * scale, w * scale, scale, line * scale)


def _say(big, small="", bg=_PAPER, fg=_INK):
    global _lcd
    if _lcd is None:
        _lcd = _LCD()
    b, f = col(*bg), col(*fg)
    _fill(b)
    _text(big, 5 if len(big) <= 5 else 3 if len(big) <= 9 else 2, 84, f, b)
    if small:
        small = small[:28]
        _text(small, 2 if len(small) <= 14 else 1, 160, f, b)


def _ink_on(c):
    return _INK if sum(c) > 380 else _PAPER


# --- the buttons -----------------------------------------------------------
# Every edge on every button pin is caught by an interrupt, so a tap made while the screen is still
# drawing counts. A press is everything touched between all-released and all-released again (40 ms
# calm): exactly the target = counts; the target with anything else = not clean; else the wrong key.
_edges = []


def _arm(pins):
    for k, p in pins.items():
        p.irq(lambda _p, k=k: _edges.append(k), Pin.IRQ_FALLING | Pin.IRQ_RISING)


def _down(pins):
    return {k for k, p in pins.items() if not p.value()}


def _released(pins, again):
    """Until nothing is down for 30 ms. Held 2 s: say which, and wait for it."""
    t, calm, warned = time.ticks_ms(), None, False
    while True:
        now = _down(pins)
        if now:
            calm = None
            if not warned and time.ticks_diff(time.ticks_ms(), t) > 2000:
                warned = True
                out("stuck", sorted(now))
                _say("LET GO", " ".join(_NAME[k] for k in sorted(now)), _RED, _PAPER)
        elif calm is None:
            calm = time.ticks_ms()
        elif time.ticks_diff(time.ticks_ms(), calm) >= 30:
            break
        time.sleep_ms(3)
    if warned:
        again()


def _touched(pins):
    """Everything touched from the first touch until all are released again (40 ms calm)."""
    del _edges[:]
    seen, calm = set(), None
    while True:
        now = _down(pins)
        while _edges:
            seen.add(_edges.pop())
        seen |= now
        if seen and not now:
            if calm is None:
                calm = time.ticks_ms()
            elif time.ticks_diff(time.ticks_ms(), calm) >= 40:
                return seen
        else:
            calm = None
        time.sleep_ms(2)


def _press(target, pins, phase):
    again = lambda: _prompt(target, phase)
    _released(pins, again)
    while True:
        seen = _touched(pins)
        if seen == {target}:
            out("ok", {"phase": phase, "key": target})
            return
        others = sorted(seen - {target})
        if target in seen:
            out("combo", {"phase": phase, "key": target, "with": others})
            _say("NOT CLEAN", _NAME[target] + " + " + " ".join(_NAME[k] for k in others), _RED, _PAPER)
        else:
            out("wrong", {"phase": phase, "want": target, "got": others[0]})
            _say("THAT WAS " + _NAME[others[0]], "PRESS " + _NAME[target], _RED, _PAPER)
        time.sleep_ms(900)
        again()
        _released(pins, again)


# The joystick's diagonals: two directions at once, never IN (the stick pressed down on its way over).
_DIAG = (("up", "left"), ("up", "right"), ("down", "left"), ("down", "right"))


def _diag(pair, pins, n):
    want, name = set(pair), "+".join(_NAME[k] for k in pair)

    def again():
        _say(name, "BOTH %d/4" % n)
        out("prompt", {"phase": 3, "key": name, "n": n})
    again()
    _released(pins, again)
    while True:
        seen = _touched(pins)
        if seen == want:
            out("ok", {"phase": 3, "key": name})
            return
        if want <= seen:
            out("combo", {"phase": 3, "key": name, "with": sorted(seen - want)})
            _say("NOT CLEAN", " ".join(_NAME[k] for k in sorted(seen - want)), _RED, _PAPER)
        else:
            _say("BOTH AT ONCE", name, _RED, _PAPER)
        time.sleep_ms(900)
        again()
        _released(pins, again)


_bg = (200, 200, 200)   # in the color pass: the last button's color, which stays up behind the next prompt


def _prompt(key, phase):
    n = _ORDER.index(key) + 1
    if phase == 1:
        _say(_NAME[key], "PRESS %d/9" % n)
    else:
        _say(_NAME[key], "COLOR %d/9" % n, _bg, _ink_on(_bg))
    out("prompt", {"phase": phase, "key": key})


def bench(chip_ok, chip_line):
    """Chip result, then every button alone in order, the joystick's four diagonals, then every button
    again filling the screen with its own color, then the verdict. Runs until done; unplugging ends it."""
    pins = {k: Pin(p, Pin.IN, Pin.PULL_UP) for k, p in KEYS.items()}
    _arm(pins)
    time.sleep_ms(5)
    _say("CHIP OK" if chip_ok else "NO CHIP", chip_line, _GREEN if chip_ok else _RED, _PAPER)
    time.sleep_ms(1500)
    for k in _ORDER:
        _prompt(k, 1)
        _press(k, pins, 1)
    for i, pair in enumerate(_DIAG):
        _diag(pair, pins, i + 1)
    global _bg
    _bg = (200, 200, 200)
    for k in _ORDER:
        _prompt(k, 2)
        _press(k, pins, 2)
        _bg = _COLOR[k]
    _fill(col(*_bg))
    time.sleep_ms(1200)
    for p in pins.values():
        p.irq(None)
    out("benchDone", {})


def verdict(ok, line):
    _say("PASS" if ok else "FAIL", line or ("UNPLUG IT" if ok else ""), _GREEN if ok else _RED, _PAPER)


# --- use the chip, lock nothing ---------------------------------------------
def chipwork(kind):
    """ATECC608: SHA-256 of random bytes on the chip (the page checks the digest) and two Random
    reads (a chip whose config isn't locked yet answers a fixed pattern: that's normal, and we don't
    lock it). Trust M: its random, its Infineon certificate, and a signature with its factory key
    over random bytes, all checked on the page. Needs the wedgie firmware's atecc.py / trustm.py."""
    import hashlib, binascii
    hx = lambda b: binascii.hexlify(b).decode()
    msg = os.urandom(100)
    d = {"kind": kind, "msg": hx(msg)}
    try:
        if kind == "atecc":
            import atecc
            a = atecc.ATECC608(sda=4, scl=5)
            a.wake()
            try:
                a.command(0x47, 0x00, 0, resp_len=1, wait_ms=10)                     # SHA start
                a.command(0x47, 0x01, 64, msg[:64], resp_len=1, wait_ms=10)          # 64 bytes
                sha = a.command(0x47, 0x02, 36, msg[64:], resp_len=32, wait_ms=10)   # last 36, digest
                r1 = a.command(0x1B, 0x01, 0, resp_len=32, wait_ms=25)               # Random, seed untouched
                r2 = a.command(0x1B, 0x01, 0, resp_len=32, wait_ms=25)
            finally:
                a.sleep()
            d.update(sha=hx(sha), random=[hx(r1), hx(r2)])
        else:
            import trustm
            trustm.bus(4, 5)
            s = trustm.Session()
            d["random"] = [hx(s.random(32)), hx(s.random(32))]
            d["cert"] = hx(s.get_all(0xE0E0))
            r, sg = s.sign(0xE0F0, hashlib.sha256(msg).digest())
            d.update(r="%064x" % r, s="%064x" % sg)
    except Exception as e:
        d["error"] = str(e) or type(e).__name__
    out("chipwork", d)


# --- the Trust M's wires, shaken ----------------------------------------------
_miss = [0]


def _w(d):
    import trustm
    for _ in range(trustm.TRIES):
        try:
            trustm.i2c.writeto(trustm.ADDR, d)
            time.sleep_us(trustm.GUARD_US)
            return
        except OSError:
            _miss[0] += 1
            time.sleep_ms(1)
    raise OSError("write not acked")


def _r(n):
    import trustm
    for _ in range(trustm.TRIES):
        try:
            r = trustm.i2c.readfrom(trustm.ADDR, n)
            time.sleep_us(trustm.GUARD_US)
            return r
        except OSError:
            _miss[0] += 1
            time.sleep_ms(1)
    raise OSError("read not acked")


# The Pico's own load: a 2 KB block written and read back over and over (each sum must come out the
# same), on its second core while the first works the chip. Nothing allocated in the loop but range().
_go = [0]           # 1: core 1 keeps pounding
_core = [0, 0, 0]   # passes, wrong sums, 1 while running


def _pass(buf):
    k = (_core[0] * 7) & 255
    for i in range(len(buf)):
        buf[i] = (i + k) & 255
    t = 0
    for i in range(len(buf)):
        t += buf[i]
    return t == len(buf) // 256 * 32640


def _core1(buf):
    _core[2] = 1
    while _go[0]:
        _core[1] += not _pass(buf)
        _core[0] += 1
    _core[2] = 0


def _sense(m):
    """Temperature (C) and VSYS (mV): the lowest and highest seen, into m."""
    from machine import ADC
    c = 27 - (ADC(4).read_u16() * 3.3 / 65535 - 0.706) / 0.001721
    v = ADC(29).read_u16() * 9900 // 65535
    m[0], m[1] = min(m[0], c), max(m[1], c)
    m[2], m[3] = min(m[2], v), max(m[3], v)


def shake(plan):
    """Pound the wedgie while its person shakes it, in phases: [[what, Hz, seconds], ...], what is
    "pico" (both cores write and check RAM, the screen redraws), "chip" (the Trust M alone) or "both".
    The chip work: 200 bytes of its certificate, 32 random bytes, a fresh P-256 key pair (hard work: the
    most current the chip draws, so a weak power or ground wire shows), and SHA-256 of 200 random bytes
    (what we send checked too), each answer checked. Counts every try the wires missed (trustm.py
    retries those quietly), every error and every wrong answer; the lowest/highest temperature and VSYS.
    Nothing that wears the chip: no writes to its memory, no stored key used (the key pair is handed
    out, nothing kept), a restart only after an error."""
    import trustm, hashlib, _thread
    keep = trustm._write, trustm._read
    trustm._write, trustm._read = _w, _r
    total = sum(p[2] for p in plan)
    gone = 0
    buf0, buf1 = bytearray(2048), bytearray(2048)   # small: Test only runs over the loaded firmware
    s = None
    try:
        for what, hz, secs in plan:
            ops = err = bad = 0
            last = ""
            m = [999, -999, 99999, 0]
            _core[0] = _core[1] = 0
            mine = [0, 0]   # core 0's own passes, wrong sums (the pico phase)
            chip = what != "pico"
            if chip:
                trustm.bus(4, 5, hz)
                s = trustm.Session()
                cert = s.get(0xE0E0, 0, 200)
                prev = b""
            _miss[0] = 0
            if what != "chip":
                _go[0] = 1
                _thread.start_new_thread(_core1, (buf1,))
            t0 = tl = time.ticks_ms()
            _say("SHAKE IT", "%s %d" % (what.upper(), total - gone), _GREEN, _PAPER)
            while time.ticks_diff(time.ticks_ms(), t0) < secs * 1000:
                if not chip:
                    mine[1] += not _pass(buf0)
                    mine[0] += 1
                else:
                    try:
                        k = ops % 4
                        if k == 0:
                            ok = s.get(0xE0E0, 0, 200) == cert
                        elif k == 3:
                            d = os.urandom(200)
                            ok = s.command(0x30, 0xE2, b"\x01\x00\xc8" + d)[3:] == hashlib.sha256(d).digest()
                        else:
                            r = s.random(32) if k == 1 else s.command(0x38, 0x03, b"\x07\x00\x00")   # GenKeyPair P-256
                            ok = (len(r) == 32 if k == 1 else len(r) > 80) and r != prev
                            prev = r
                        ops += 1
                        bad += not ok
                    except Exception as e:
                        err += 1
                        last = str(e)[:40]
                        try:
                            s = trustm.Session()
                        except Exception:
                            pass
                _sense(m)
                if time.ticks_diff(time.ticks_ms(), tl) >= 1000:
                    tl = time.ticks_ms()
                    left = total - gone - time.ticks_diff(tl, t0) // 1000
                    sick = err or bad or _core[1] or mine[1]
                    _say("SHAKE IT", "%s %d" % (what.upper(), max(left, 0)), _RED if sick else _GREEN, _PAPER)
                    out("shake", {"what": what, "hz": hz, "ops": ops, "miss": _miss[0], "err": err, "bad": bad,
                                  "ram": _core[0] + mine[0], "ramBad": _core[1] + mine[1], "left": left})
            _go[0] = 0
            t = time.ticks_ms()
            while _core[2] and time.ticks_diff(time.ticks_ms(), t) < 3000:
                time.sleep_ms(5)
            gone += secs
            out("shook", {"what": what, "hz": hz, "ops": ops, "miss": _miss[0], "err": err, "bad": bad, "last": last,
                          "ram": _core[0] + mine[0], "ramBad": _core[1] + mine[1],
                          "temp": [round(m[0], 1), round(m[1], 1)], "vsys": [m[2], m[3]]})
    finally:
        _go[0] = 0
        trustm._write, trustm._read = keep
        trustm.bus(4, 5)
