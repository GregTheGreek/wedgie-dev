# Opens a wedgie1 secret message, given the 32-byte ECDH secret the chip worked out. No chip in here, so
# the same file runs on a computer (wedgie-dev tools/test_secret.py) as on the wedgie.
#
# A message to a wedgie whose public key is P (65 bytes: 04 X Y), made in the sender's browser
# (wedgie.dev/secret, src/secret/box.mjs):
#   E   a new P-256 key pair for this one message; z = ECDH(E's private key, P), the X coordinate
#   k   HKDF-SHA256(ikm=z, salt=none, info="wedgie1" + E + P), 64 bytes: AES key, then HMAC key
#   ct  AES-256-CBC(PKCS#7) of the UTF-8 text under k[:32], with a random 16-byte iv
#   tag HMAC-SHA256(k[32:], iv + ct)
#   "wedgie1." + base64url(E + iv + ct + tag), no padding
# Only the chip holding P's private key can work out z from E.
import hashlib, binascii, cryptolib

PREFIX = "wedgie1."
INFO = b"wedgie1"


def _hmac(k, m):
    k = k + bytes(64 - len(k))                  # keys here are always 32 bytes
    i = bytes(b ^ 0x36 for b in k)
    o = bytes(b ^ 0x5C for b in k)
    return hashlib.sha256(o + hashlib.sha256(i + m).digest()).digest()


def keys(z, e, p):
    """HKDF-SHA256, 64 bytes: (AES key, HMAC key)."""
    prk = _hmac(bytes(32), z)
    t1 = _hmac(prk, INFO + e + p + b"\x01")
    t2 = _hmac(prk, t1 + INFO + e + p + b"\x02")
    return t1, t2


def parse(blob):
    """(E, iv, ct, tag) from the text, or ValueError."""
    s = "".join(str(blob).split())              # a chat app may wrap it
    if not s.startswith(PREFIX):
        raise ValueError("not a wedgie1 message")
    s = s[len(PREFIX):].replace("-", "+").replace("_", "/")
    try:
        b = binascii.a2b_base64(s + "=" * (-len(s) % 4))
    except Exception:
        raise ValueError("garbled")
    n = len(b) - 65 - 16 - 32
    if n < 16 or n % 16 or b[0] != 4:
        raise ValueError("garbled")
    return b[:65], b[65:81], b[81:81 + n], b[81 + n:]


def open_box(z, e, p, iv, ct, tag):
    """The message's bytes, or ValueError when the tag doesn't match (another key's, or changed)."""
    ka, km = keys(z, e, p)
    t = _hmac(km, iv + ct)
    if sum(a ^ b for a, b in zip(t, tag)) or len(tag) != 32:
        raise ValueError("not for this wedgie")
    m = cryptolib.aes(ka, 2, iv).decrypt(ct)
    n = m[-1]
    if not 1 <= n <= 16 or m[-n:] != bytes([n]) * n:
        raise ValueError("garbled")
    return m[:-n]
