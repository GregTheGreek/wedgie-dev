// A buyer's address is sealed here, in their browser, to the shipping computer's public key (omen,
// wedgie-shipping orders.py). Only that computer can open it: our server, its database, Stripe and the
// chain only ever see the sealed text. Format "v1.<epk>.<iv>.<ct>" (base64url):
//   a fresh P-256 key per order; ECDH with SEAL_KEY; HKDF-SHA256 (salt = epk, info "wedgie order v1")
//   -> AES-256-GCM. orders.py open_sealed() is the other half; keep the two in step.

// The shipping computer's public key (uncompressed P-256 point, base64url). Its private half is made by
// `orders.py keygen` on omen and never leaves it. It's committed here, not set on the server, so a
// changed key shows in git. Empty = the shop stays closed. VITE_SEAL_KEY is for the probes' test key.
const OMEN_KEY = "BGH00bcOxeN8KvqPy64-hPKDsu7-zlPru_C-y87P1ujL1oDei8yBD53W6Ts0TEJFcnWqTg1kIFJAc7W3w-WTYuU";
export const SEAL_KEY: string = import.meta.env.VITE_SEAL_KEY || OMEN_KEY;

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(data: unknown, key = SEAL_KEY): Promise<string> {
  const c = crypto.subtle;
  const them = await c.importKey("raw", unb64u(key), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const mine = await c.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const epk = new Uint8Array(await c.exportKey("raw", mine.publicKey));
  const shared = await c.deriveBits({ name: "ECDH", public: them }, mine.privateKey, 256);
  const hk = await c.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await c.deriveKey({ name: "HKDF", hash: "SHA-256", salt: epk, info: new TextEncoder().encode("wedgie order v1") },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await c.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(data)));
  return ["v1", b64u(epk), b64u(iv), b64u(ct)].join(".");
}
