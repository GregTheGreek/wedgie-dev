#!/usr/bin/env python3
"""Secret messages end to end, minus the chip: src/secret/box.ts seals in Node (WebCrypto, as the
browser does), and the wedgie app's own secret_box.py opens it here, with Python's `cryptography` playing
the chip (the ECDH) and cryptolib (AES-CBC). Also: a message to another key, a changed one, garbage.

  python3 tools/test_secret.py [--app <wedgie-secret checkout>]   (default: the shelf's copy in community/)
"""
import json, subprocess, sys, types
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parent.parent
app = Path(sys.argv[sys.argv.index("--app") + 1]) if "--app" in sys.argv else ROOT / "community/clawdbotatg/wedgie-secret"


class _Aes:                                         # MicroPython's cryptolib.aes, CBC only
    def __init__(self, key, mode, iv):
        assert mode == 2
        self.c = Cipher(algorithms.AES(key), modes.CBC(iv))

    def decrypt(self, b):
        d = self.c.decryptor()
        return d.update(b) + d.finalize()


sys.modules["cryptolib"] = types.SimpleNamespace(aes=_Aes)
sys.path.insert(0, str(app))
import secret_box as B  # noqa: E402

fails = 0


def check(ok, what):
    global fails
    print(("ok   " if ok else "FAIL ") + what)
    fails += not ok


def pub(k):
    return k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def seal(p, texts):
    js = ("import * as S from './src/secret/box.ts';"
          "const p = Uint8Array.from(Buffer.from(process.argv[1], 'hex'));"
          "const out = []; for (const t of JSON.parse(process.argv[2])) out.push(await S.seal(p, t));"
          "console.log(JSON.stringify({out, id: await S.keyId(p), key: S.parseKey(S.link(p)) && Buffer.from(S.parseKey(S.link(p))).toString('hex')}));")
    r = subprocess.run(["node", "--input-type=module", "-e", js, p.hex(), json.dumps(texts)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)
    return json.loads(r.stdout)


def open_with(k, blob):
    e, iv, ct, tag = B.parse(blob)
    z = k.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), e))
    return B.open_box(z, e, pub(k), iv, ct, tag)


me, other = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
texts = ["hi", "x" * 15, "y" * 16, "meet at the usual place.\nbring the thing ✌️", "z" * 1500]
r = seal(pub(me), texts)
for t, b in zip(texts, r["out"]):
    try:
        got = open_with(me, b).decode()
    except Exception as e:
        got = "error: %s" % e
    check(got == t, "opens: %d bytes -> %d chars of text" % (len(t.encode()), len(b)))

import hashlib  # noqa: E402
h = hashlib.sha256(pub(me)).hexdigest()[:8]
check(r["id"] == h[:4] + " " + h[4:], "key id matches the wedgie's: %s" % r["id"])
check(r["key"] == pub(me).hex(), "a share link parses back to the key")


def refused(blob, k, why):
    try:
        open_with(k, blob)
        check(False, why + ": opened anyway")
    except ValueError as e:
        check(True, "%s: %s" % (why, e))


refused(r["out"][0], other, "another wedgie's key")
b = r["out"][3]
i = len(B.PREFIX) + 100
refused(b[:i] + ("A" if b[i] != "A" else "B") + b[i + 1:], me, "changed on the way")
refused("wedgie1.abc", me, "too short")
refused("hello", me, "not one")
check(B.parse(" \n".join([b[:40], b[40:]]))[0][0] == 4, "survives a chat app's line wrap")
print("FAIL: %d" % fails if fails else "all ok")
sys.exit(1 if fails else 0)
