/**
 * Compact FIPS 46-3 DES (ECB) on 32-bit halves. Used to decrypt part blocks
 * in XZZ `.pcb` files with a user-provided key.
 */

const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const S = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

/** Bit arrays keep the implementation readable; per-block cost is negligible for XZZ part blocks. */
type Bits = Uint8Array;

function toBits(bytes: Uint8Array): Bits {
  const b = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < b.length; i++) b[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return b;
}

const permute = (src: Bits, table: number[]): Bits => {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = src[table[i] - 1];
  return out;
};

export function desKeySchedule(key: Uint8Array): Bits[] {
  const k = permute(toBits(key), PC1);
  let c = k.slice(0, 28);
  let d = k.slice(28);
  const subkeys: Bits[] = [];
  for (const s of SHIFTS) {
    c = new Uint8Array([...c.slice(s), ...c.slice(0, s)]);
    d = new Uint8Array([...d.slice(s), ...d.slice(0, s)]);
    const cd = new Uint8Array(56);
    cd.set(c);
    cd.set(d, 28);
    subkeys.push(permute(cd, PC2));
  }
  return subkeys;
}

function feistel(r: Bits, k: Bits): Bits {
  const e = permute(r, E);
  for (let i = 0; i < 48; i++) e[i] ^= k[i];
  const out = new Uint8Array(32);
  for (let s = 0; s < 8; s++) {
    const o = s * 6;
    const row = (e[o] << 1) | e[o + 5];
    const col = (e[o + 1] << 3) | (e[o + 2] << 2) | (e[o + 3] << 1) | e[o + 4];
    const v = S[s][row * 16 + col];
    for (let j = 0; j < 4; j++) out[s * 4 + j] = (v >> (3 - j)) & 1;
  }
  return permute(out, P);
}

export function desBlock(block: Uint8Array, subkeys: Bits[], decrypt: boolean): Uint8Array {
  const ip = permute(toBits(block), IP);
  let l = ip.slice(0, 32);
  let r = ip.slice(32);
  for (let i = 0; i < 16; i++) {
    const f = feistel(r, subkeys[decrypt ? 15 - i : i]);
    const nr = new Uint8Array(32);
    for (let j = 0; j < 32; j++) nr[j] = l[j] ^ f[j];
    l = r;
    r = nr;
  }
  const rl = new Uint8Array(64);
  rl.set(r);
  rl.set(l, 32);
  const fp = permute(rl, FP);
  const out = new Uint8Array(8);
  for (let i = 0; i < 64; i++) out[i >> 3] |= fp[i] << (7 - (i & 7));
  return out;
}

/* ------------------------------------------------------------------ */
/* Table-driven fast path (~50× faster). Tables are derived from the    */
/* same FIPS permutation definitions as the reference implementation.   */
/* ------------------------------------------------------------------ */

type Word2 = [Uint32Array, Uint32Array]; // [hi, lo] contributions

/** For a bit permutation with ≤64 outputs over `inBytes` input bytes: per (byte position, value) → output words. */
function permTable(table: number[], inBytes: number): Word2[] {
  const out: Word2[] = [];
  for (let b = 0; b < inBytes; b++) {
    const hi = new Uint32Array(256);
    const lo = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      let h = 0, l = 0;
      for (let i = 0; i < table.length; i++) {
        const src = table[i] - 1;
        if ((src >> 3) !== b || !((v >> (7 - (src & 7))) & 1)) continue;
        if (i < 32) h |= 1 << (31 - i);
        else l |= 1 << (63 - i);
      }
      hi[v] = h >>> 0;
      lo[v] = l >>> 0;
    }
    out.push([hi, lo]);
  }
  return out;
}

let FAST: { ip: Word2[]; fp: Word2[]; e: Word2[]; sp: Uint32Array[] } | null = null;

function fastTables() {
  if (FAST) return FAST;
  const sp: Uint32Array[] = [];
  for (let s = 0; s < 8; s++) {
    const t = new Uint32Array(64);
    for (let x = 0; x < 64; x++) {
      const row = ((x >> 5) << 1) | (x & 1);
      const col = (x >> 1) & 15;
      const v = S[s][row * 16 + col];
      // place the 4 S-box bits at positions s*4..s*4+3, then apply P
      let pre = 0;
      for (let j = 0; j < 4; j++) if ((v >> (3 - j)) & 1) pre |= 1 << (31 - (s * 4 + j));
      let post = 0;
      for (let i = 0; i < 32; i++) if ((pre >>> (31 - (P[i] - 1))) & 1) post |= 1 << (31 - i);
      t[x] = post >>> 0;
    }
    sp.push(t);
  }
  FAST = { ip: permTable(IP, 8), fp: permTable(FP, 8), e: permTable(E, 4), sp };
  return FAST;
}

/** Subkeys packed as 48-bit [hi32, lo16<<16] pairs matching the E-table layout. */
function packSubkeys(subkeys: Bits[]): Uint32Array {
  const out = new Uint32Array(32);
  subkeys.forEach((k, r) => {
    let h = 0, l = 0;
    for (let i = 0; i < 48; i++) {
      if (!k[i]) continue;
      if (i < 32) h |= 1 << (31 - i);
      else l |= 1 << (63 - i);
    }
    out[r * 2] = h >>> 0;
    out[r * 2 + 1] = l >>> 0;
  });
  return out;
}

const keyCache = new WeakMap<Bits[], Uint32Array>();

/** ECB decrypt; a trailing partial block is zero-padded, matching the reference implementation. */
export function desDecryptECB(data: Uint8Array, subkeys: Bits[]): Uint8Array {
  const T = fastTables();
  let K = keyCache.get(subkeys);
  if (!K) keyCache.set(subkeys, (K = packSubkeys(subkeys)));
  const { ip, fp, e, sp } = T;
  const out = new Uint8Array(data.length);
  const blk = new Uint8Array(8);
  for (let o = 0; o < data.length; o += 8) {
    const full = o + 8 <= data.length;
    const src = full ? data : (blk.fill(0), blk.set(data.subarray(o)), blk);
    const base = full ? o : 0;
    let L = 0, R = 0;
    for (let b = 0; b < 8; b++) {
      const v = src[base + b];
      L |= ip[b][0][v];
      R |= ip[b][1][v];
    }
    L >>>= 0;
    R >>>= 0;
    for (let round = 15; round >= 0; round--) {
      const e0 = (e[0][0][R >>> 24] | e[1][0][(R >>> 16) & 255] | e[2][0][(R >>> 8) & 255] | e[3][0][R & 255]) ^ K[round * 2];
      const e1 = (e[0][1][R >>> 24] | e[1][1][(R >>> 16) & 255] | e[2][1][(R >>> 8) & 255] | e[3][1][R & 255]) ^ K[round * 2 + 1];
      const f =
        sp[0][(e0 >>> 26) & 63] ^ sp[1][(e0 >>> 20) & 63] ^ sp[2][(e0 >>> 14) & 63] ^ sp[3][(e0 >>> 8) & 63] ^
        sp[4][(e0 >>> 2) & 63] ^ sp[5][((e0 & 3) << 4) | (e1 >>> 28)] ^ sp[6][(e1 >>> 22) & 63] ^ sp[7][(e1 >>> 16) & 63];
      const nr = (L ^ f) >>> 0;
      L = R;
      R = nr;
    }
    // preoutput is R‖L
    const pre = [R >>> 24, (R >>> 16) & 255, (R >>> 8) & 255, R & 255, L >>> 24, (L >>> 16) & 255, (L >>> 8) & 255, L & 255];
    let h = 0, l = 0;
    for (let b = 0; b < 8; b++) {
      h |= fp[b][0][pre[b]];
      l |= fp[b][1][pre[b]];
    }
    const n = Math.min(8, data.length - o);
    const bytes = [h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, l >>> 24, (l >>> 16) & 255, (l >>> 8) & 255, l & 255];
    for (let i = 0; i < n; i++) out[o + i] = bytes[i];
  }
  return out;
}

export function parseDesKey(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{16}$/i.test(clean)) return null;
  const k = new Uint8Array(8);
  for (let i = 0; i < 8; i++) k[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return k;
}

/** Odd-parity bytes except the last one, as enforced by the reference reader. */
export function checkXzzKey(key: Uint8Array): boolean {
  const expected = [1, 1, 1, 1, 1, 1, 1, 0];
  // Reference checks bytes from least significant (last) to most significant (first).
  for (let i = 0; i < 8; i++) {
    let t = key[7 - i];
    t ^= t >> 4;
    t ^= t >> 2;
    t ^= t >> 1;
    if ((~t & 1) !== expected[i]) return false;
  }
  return true;
}
