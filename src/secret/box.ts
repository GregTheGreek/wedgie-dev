// Secret messages to a wedgie, sealed in the browser (WebCrypto, no library): anyone with a wedgie's public
// key makes one, and only that wedgie's chip can open it. The format, and the wedgie's side, is
// secret_box.py in clawdbotatg/wedgie-secret:
//   E = a new P-256 key for this message, z = ECDH(E, P)
//   k = HKDF-SHA256(z, no salt, "wedgie1" + E + P, 64): AES key, HMAC key
//   "wedgie1." + base64url(E + iv + AES-256-CBC(text) + HMAC-SHA256(iv + ct))
// Runs in Node too (tools/test_secret.py).

const C = globalThis.crypto.subtle;
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
export const PREFIX = "wedgie1.";
export const MAX = 1500;            // bytes of text: about six screens on the wedgie

const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of a) { o.set(x, i); i += x.length; }
  return o;
};
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

export function b64u(u: Uint8Array) {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(-s.length & 3));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

/** A public key from what someone pasted: a wedgie.dev/secret link, base64url, or hex (04 X Y). Null if it isn't one. */
export function parseKey(s: string): Uint8Array | null {
  s = s.trim().replace(/^.*#/, "");
  let k: Uint8Array | null = null;
  try {
    if (/^(0x)?04[0-9a-f]{128}$/i.test(s)) k = Uint8Array.from(s.replace(/^0x/i, "").match(/../g)!, (h) => parseInt(h, 16));
    else if (/^[\w-]{87}$/.test(s)) k = unb64u(s);
  } catch { return null; }
  return k && k.length === 65 && k[0] === 4 ? k : null;
}

/** What the wedgie's screen shows for a key: the first 4 bytes of sha256(pub), "a1b2 c3d4". */
export async function keyId(pub: Uint8Array) {
  const h = [...new Uint8Array(await C.digest("SHA-256", buf(pub)))].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 4)} ${h.slice(4)}`;
}

export const link = (pub: Uint8Array, origin = "https://wedgie.dev") => `${origin}/secret#${b64u(pub)}`;
export const isSealed = (s: string) => s.trim().startsWith(PREFIX);
export const size = (text: string) => new TextEncoder().encode(text).length;

/** The text sealed to pub. Throws if pub isn't a P-256 point. */
export async function seal(pub: Uint8Array, text: string): Promise<string> {
  const m = new TextEncoder().encode(text);
  if (!m.length) throw new Error("Nothing to seal.");
  if (m.length > MAX) throw new Error(`Too long: ${m.length} bytes, at most ${MAX}.`);
  const P = await C.importKey("raw", buf(pub), P256, false, []);
  const kp = await C.generateKey(P256, true, ["deriveBits"]) as CryptoKeyPair;
  const E = new Uint8Array(await C.exportKey("raw", kp.publicKey));
  const z = await C.deriveBits({ name: "ECDH", public: P }, kp.privateKey, 256);
  const ikm = await C.importKey("raw", z, "HKDF", false, ["deriveBits"]);
  const info = cat(new TextEncoder().encode("wedgie1"), E, pub);
  const k = new Uint8Array(await C.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: buf(info) }, ikm, 512));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ak = await C.importKey("raw", buf(k.slice(0, 32)), "AES-CBC", false, ["encrypt"]);
  const ct = new Uint8Array(await C.encrypt({ name: "AES-CBC", iv }, ak, buf(m)));
  const mk = await C.importKey("raw", buf(k.slice(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const tag = new Uint8Array(await C.sign("HMAC", mk, buf(cat(iv, ct))));
  return PREFIX + b64u(cat(E, iv, ct, tag));
}
