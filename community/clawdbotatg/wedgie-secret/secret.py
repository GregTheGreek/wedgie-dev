# Secrets: messages only your wedgie can read. Anyone with its public key writes one at wedgie.dev/secret
# (no wedgie needed) and sends the text it makes over any chat. You paste it into wedgie.dev/secret, the
# wedgie asks, and on a real A press its chip opens it and the message shows on the wedgie's screen. It
# never goes back to the computer.
#
# The key: made once, on the wedgie (A on its screen), in the Trust M's key slot 3 or the ATECC608's slot 2.
# Not the Safe Signer's key (slot 2 / slot 0): a messaging key never signs money. It never leaves the chip.
# An ATECC608 as shipped can't hold a key until its config is written and locked: the question says so, and
# the yes locks it (for good; the same table the Safe Signer locks, atecc.CONFIG, whose slot 2 is a P-256
# key that may do ECDH). The public key is saved (/saves/secret/key) because the Trust M hands it out only
# when it makes the key. The message format: secret_box.py.
#
# USB (one JSON line each way; everything else goes to the slot, so hello/shot/jobs still work):
#   {"id":1,"type":"secret_open","blob":"wedgie1...."}
#   -> {"id":1,"type":"secret_shown"}: it's on the wedgie's screen now (Y closes it)
#   -> {"id":1,"type":"refused"} (Y, or no answer in 2 minutes) or {"type":"error","error":".."}
#      ("not for this wedgie": another key's message, or changed on the way)
#   hello answers also carry "secret": {"pub":"04..","chip":"..","id":"a1b2 c3d4"} (or null: no key yet).
#   id is the first 4 bytes of sha256(pub): the wedgie's screen shows it, so a sender can check the key.
import sys, select, json, time, gc, binascii, hashlib
import lcd as L
import wedgie as W
import save
import ui
from ui import WHITE, INK, MUTED, RED

FW = "secret-1"
ASK_MS = 120000
READ_MS = 300000        # a message left open closes itself after 5 minutes
ROWS = 10               # message lines on one screen
COLS = ui.COLS_SMALL

d = None
keys = None
_poll = None
key = None              # {"pub": "04..", "chip": "ATECC608" | "OPTIGA Trust M", "id": "a1b2 c3d4"} or None
note = ""
dirty = True


def key_id(pub):
    h = binascii.hexlify(hashlib.sha256(pub).digest()[:4]).decode()
    return h[:4] + " " + h[4:]


# ---- the chip ---------------------------------------------------------------------------------

def _atecc():
    """The ATECC608 if one answers on GP4/GP5, else None (then it's a Trust M)."""
    try:
        import atecc
        a = atecc.ATECC608(sda=4, scl=5)
        a.wake()
        a.sleep()
        return a
    except MemoryError:
        raise
    except Exception:
        return None


def _unload():
    for m in ("optiga", "atecc"):
        if m in sys.modules:
            del sys.modules[m]
    gc.collect()


def key_question():
    try:
        a = _atecc()
        if not a:
            return ["Replaces chip key slot 3.", "Old messages to it can't be read."]
        if not a.lock_state()["configLocked"]:
            return ["Locks the chip for good.", "Can't undo."]
        return ["Replaces chip key slot 2.", "Old messages to it can't be read."]
    except Exception:
        return ["Replaces the chip's key."]
    finally:
        _unload()


def make_key():
    global key
    ui.progress("Making your key", "in the chip", False)
    try:
        a = _atecc()
        if a:
            if not a.lock_state()["configLocked"]:
                a.write_config()                # checked byte for byte, then locked: permanent
                a.lock_config()
            x, y = a.genkey_new(2)
            pub, chip = b"\x04" + x.to_bytes(32, "big") + y.to_bytes(32, "big"), "ATECC608"
        else:
            import optiga
            pub, chip = optiga.Chip().genkey(optiga.KEY3, optiga.P256, optiga.KEY_AGREE), "OPTIGA Trust M"
        key = {"pub": binascii.hexlify(pub).decode(), "chip": chip, "id": key_id(pub)}
        save.store("key", key)
    finally:
        _unload()


def ecdh(e):
    """The 32-byte shared secret of the wedgie's key and E (04 X Y)."""
    try:
        if key.get("chip") == "ATECC608":
            a = _atecc()
            if not a:
                raise OSError("the key is in an ATECC608 and none answered")
            # ECDH (0x43), mode 0: the slot's own rule, and slot 2's (ReadKey bit 3 clear) hands it back
            return a.run(0x43, 0x00, 2, e[1:65], resp_len=32, wait_ms=60)
        import optiga
        return optiga.Chip().ecdh(optiga.KEY3, e)
    finally:
        _unload()


# ---- screens ----------------------------------------------------------------------------------

def draw_home():
    d.fill(WHITE)
    ui.band(d)
    ui.title(d, "Secrets", 42, 1)
    if key:
        d.center_text("your key", 84, MUTED)
        d.center_text(key["id"], 100, INK, 3)
        d.center_text("wedgie.dev/secret", 140, MUTED)
    else:
        d.center_text("No key", 90, INK, 2)
    if note:
        d.center_text(note[:COLS], 170 if not key else 160, MUTED)
    if not key:
        ui.buttons(d, "make a key", "not now")
    d.show()


def text_lines(m):
    """The message as screen lines: wrapped words, long words cut, anything the font lacks as ?."""
    try:
        s = m.decode()
    except Exception:
        s = "".join(chr(b) for b in m)
    out = []
    for para in s.split("\n"):
        para = "".join(c if " " <= c <= "~" else "?" for c in para)
        for l in (ui.wrap(para) if para.strip() else [""]):
            while len(l) > COLS:
                out.append(l[:COLS])
                l = l[COLS:]
            out.append(l)
    return out


def read(lines):
    """The message on the screen until Y (or READ_MS), a screen at a time: down for the next, up back."""
    k = L.Keys(physical=True)
    k.pressed()
    n = (len(lines) + ROWS - 1) // ROWS
    at, t0 = 0, time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t0) < READ_MS:
        d.fill(WHITE)
        ui.band(d)
        ui.title(d, "Secret", 42, 1)
        for i, s in enumerate(lines[at * ROWS:at * ROWS + ROWS]):
            d.text(s, 8, 74 + i * 14, INK)
        ui.say(d, "{r} close" + ("  up/down %d/%d" % (at + 1, n) if n > 1 else ""), 222, MUTED)
        d.show()
        moved = False
        while not moved and time.ticks_diff(time.ticks_ms(), t0) < READ_MS:
            for kk in k.pressed():
                if kk == "Y":
                    return
                if kk == "down" and at + 1 < n:
                    at, moved = at + 1, True
                elif kk == "up" and at:
                    at, moved = at - 1, True
            time.sleep_ms(20)
        if moved:
            t0 = time.ticks_ms()


# ---- requests ---------------------------------------------------------------------------------

def on_open(mid, blob):
    global note
    if not key:
        W.send({"id": mid, "type": "error", "error": "no key yet: press green on the wedgie to make one"})
        return
    import secret_box as B
    try:
        e, iv, ct, tag = B.parse(blob)
    except ValueError as x:
        W.send({"id": mid, "type": "error", "error": str(x)})
        return
    blob = None
    gc.collect()
    if not ui.ask(d, "Read a secret?", (), "read", "no", ASK_MS):
        note = "said no"
        W.send({"id": mid, "type": "refused"})
        return
    ui.progress("Opening", "in the chip", False)
    try:
        m = B.open_box(ecdh(e), e, binascii.unhexlify(key["pub"]), iv, ct, tag)
    except ValueError as x:
        note = str(x)
        W.send({"id": mid, "type": "error", "error": str(x)})
        return
    finally:
        del sys.modules["secret_box"]
        e = iv = ct = tag = None
        gc.collect()
    lines = text_lines(m)
    m = None
    note = ""
    W.send({"id": mid, "type": "secret_shown"})
    read(lines)


def handle(m):
    global dirty
    mid, t = m.get("id"), m.get("type")
    if t == "secret_open":
        on_open(mid, m.get("blob"))
        dirty = True
    elif t == "hello":
        W.send(W.hello(mid, running="secret", app=FW, secret=key))
    else:                               # hello's cousins, shots, jobs, open: the slot's
        import slot
        slot.handle(m)
        dirty = True


def pump():
    """One request per call, read through the one line reader (wedgie.lines)."""
    global dirty
    R = W.lines()
    line = R.pump(_poll)
    if R.intr:                          # a Ctrl-C while sealed: the red question (hatch.py)
        R.intr = False
        if W.SEALED and not W.is_open():
            try:
                import hatch
                ok = hatch.ctrl_c()
            except Exception as e:
                sys.print_exception(e)
                ok = False
            if ok:
                raise KeyboardInterrupt
            dirty = True
    if line is False:
        W.send({"type": "error", "error": "line too long"})
    elif line and line.strip():
        try:
            m = json.loads(line)
        except Exception:
            line = None
            gc.collect()
            W.send({"type": "error", "error": "bad json"})
            return
        line = None
        if not isinstance(m, dict):
            return
        try:
            handle(m)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as e:
            dirty = True
            W.failed(m.get("id"), e)


def run():
    global d, keys, _poll, key, dirty, note
    d = L.LCD()
    keys = L.Keys(physical=True)
    _poll = select.poll()
    _poll.register(sys.stdin, select.POLLIN)
    key = save.load("key", None)
    W.send(W.hello(None, type="ready", running="secret", app=FW, secret=key))
    while True:
        for k in keys.pressed():
            if k == "A" and not key:
                if ui.ask(d, "Make a key?", key_question()):
                    try:
                        make_key()
                        note = "key made"
                    except Exception as e:
                        sys.print_exception(e)
                        note = "no key: %s" % e
                dirty = True
        pump()
        if dirty:
            draw_home()
            dirty = False
        time.sleep_ms(20)
