#!/usr/bin/env python3
"""Safe Signer's key (the shelf's community/clawdbotatg/wedgie-safe/safe_key.py) against a fake Trust M that
keeps the rules a real one showed (2026-10-15, tools/optigaprobe.py's chip): a key slot never reads out, a
genkey replaces an unlocked key, and once an object's lifecycle is 0x07 every write, genkey and metadata change
is refused. The promise checked: the person's key is made once, kept in the chip with its public key, locked
for good, and never replaced, and a chip that holds someone else's locked key is never used.
    python3 tools/test_safekey.py   (or: python3 tools/test_safekey.py <wedgie-safe checkout>)"""
import hashlib, os, sys, types
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed, decode_dss_signature, encode_dss_signature
from cryptography.exceptions import InvalidSignature

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
app = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "community/clawdbotatg/wedgie-safe")
bad = 0


def check(ok, what):
    global bad
    print(("ok  " if ok else "FAIL"), what)
    bad += not ok


class Refused(OSError):
    pass


def pub_of(k):
    n = k.public_key().public_numbers()
    return b"\x04" + n.x.to_bytes(32, "big") + n.y.to_bytes(32, "big")


class TrustM:
    """KEY2 and DATA[11] as a real chip keeps them."""
    KEY2, DATA = 0xE0F1, [0xF1D0 + i for i in range(12)]

    def __init__(self):
        self.keys = {}                          # oid -> private key
        self.data = {o: b"" for o in self.DATA}
        self.lcs = {}                           # oid -> lifecycle byte

    def _open(self, oid):
        if self.lcs.get(oid, 1) >= 7:
            raise Refused("optiga: access conditions not satisfied (0x07)")

    def metadata(self, oid):
        return {0xC0: bytes([self.lcs.get(oid, 1)])}

    def set_metadata(self, oid, tags):
        self._open(oid)
        for t, v in tags.items():
            if t == 0xC0:
                if v[0] < self.lcs.get(oid, 1):
                    raise Refused("optiga: invalid parameter in data (0x05)")     # a lifecycle only goes up
                self.lcs[oid] = v[0]

    def genkey(self, slot):
        self._open(slot)
        self.keys[slot] = ec.generate_private_key(ec.SECP256R1())
        return pub_of(self.keys[slot])

    def read(self, oid):
        if oid in (self.KEY2,):
            raise Refused("optiga: access conditions not satisfied (0x07)")
        return self.data[oid]

    def write(self, oid, b, erase=False):
        self._open(oid)
        self.data[oid] = b

    def random(self, n):
        return os.urandom(n)

    def sign(self, slot, digest):
        if slot not in self.keys:
            raise Refused("optiga: empty key slot")
        return decode_dss_signature(self.keys[slot].sign(digest, ec.ECDSA(Prehashed(hashes.SHA256()))))

    def verify(self, digest, r, s, pub):
        try:
            ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub).verify(
                encode_dss_signature(r, s), digest, ec.ECDSA(Prehashed(hashes.SHA256())))
            return True
        except (InvalidSignature, ValueError):
            return False


chip = None
optiga = types.ModuleType("optiga")
optiga.KEY2, optiga.DATA = TrustM.KEY2, TrustM.DATA
optiga.Chip = lambda: chip
sys.modules["optiga"] = optiga
ui = types.ModuleType("ui")
ui.progress = lambda *a, **k: None
sys.modules["ui"] = ui
sys.path.insert(0, app)
import safe_key as K

src = open(os.path.join(app, "safe.py")).read() + open(os.path.join(app, "safe_key.py")).read()
check(src.count("genkey(optiga.KEY2)") == 1, "one place makes a Trust M key (safe_key.make)")
check("optiga.KEY3" not in src and "optiga.KEY4" not in src, "Safe Signer never touches KEY3 / KEY4 (other apps' slots)")

# a fresh chip: no key; the person makes one; it's kept in the chip and locked for good
chip = TrustM()
check(K.start(None) == ("none", None), "fresh chip: no key")
k = K.make()
check(K.start(None) == ("ok", k), "made: the chip gives it back (the Pico keeps nothing)")
check(chip.lcs.get(TrustM.KEY2) == 7 and chip.lcs.get(TrustM.DATA[11]) == 7, "made: key and public key locked")
try:
    K.make()
    check(False, "a second make is refused")
except OSError:
    check(True, "a second make is refused")
check(K.start(None) == ("ok", k), "still the same key after the refused make")
for what, f in (("a new key", lambda: chip.genkey(TrustM.KEY2)), ("a new public key", lambda: chip.write(TrustM.DATA[11], b"x")),
                ("an unlock", lambda: chip.set_metadata(TrustM.KEY2, {0xC0: b"\x01"}))):
    try:
        f()
        check(False, "after the lock, %s from any app is refused" % what)
    except Refused:
        check(True, "after the lock, %s from any app is refused" % what)
check(K.start({"x": "0x" + "11" * 32, "y": "0x" + "22" * 32}) == ("ok", k), "a planted save changes nothing")

# someone else's key, locked: never used
chip = TrustM()
chip.genkey(TrustM.KEY2)
chip.set_metadata(TrustM.KEY2, {0xC0: b"\x07"})
check(K.start(None) == ("swap", None), "someone else's locked key: swap the chip")
chip.write(TrustM.DATA[11], K.MAGIC + pub_of(ec.generate_private_key(ec.SECP256R1()))[1:])
check(K.start(None) == ("swap", None), "a public key copy that isn't the chip's key: swap the chip")

# someone else's key, not locked, no copy: no key; making one replaces it
chip = TrustM()
chip.genkey(TrustM.KEY2)
check(K.start(None) == ("none", None), "someone else's unlocked key: treated as no key")
old = chip.keys[TrustM.KEY2]
k = K.make()
check(chip.keys[TrustM.KEY2] is not old and K.start(None) == ("ok", k), "making a key replaces it")

# unplugged between the copy and the lock: the next start finishes the lock
chip = TrustM()
p = chip.genkey(TrustM.KEY2)
chip.write(TrustM.DATA[11], K.MAGIC + p[1:])
check(K.start(None)[0] == "ok" and chip.lcs.get(TrustM.KEY2) == 7, "a make cut off before its lock: locked at next start")

# a key from safe-12 (public key only in the save): the person locks it, or makes their own
chip = TrustM()
p = chip.genkey(TrustM.KEY2)
saved = {"x": "0x" + p[1:33].hex(), "y": "0x" + p[33:65].hex(), "chip": "OPTIGA Trust M"}
st, k = K.start(saved)
check(st == "lock", "a safe-12 key: asked to lock it, never locked by itself")
check(chip.lcs.get(TrustM.KEY2, 1) == 1, "a safe-12 key: still unlocked until the person says")
K.lock(k)
check(K.start(None) == ("ok", k), "locked: the chip gives it back")

print("%d FAILED" % bad if bad else "all ok")
sys.exit(1 if bad else 0)
