/**
 * RC6-based stream decoder used by ASUS `.fz` boardviews (CFB-like mode,
 * one byte per block evaluation). The 44-word expanded key must be supplied
 * by the user; none is distributed with this application.
 */

const rotl = (a: number, b: number) => ((a << b) | (a >>> (32 - b))) >>> 0;

const PARITY = [0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1];

/** Parity check used to reject mistyped keys before an expensive decode. */
export function checkFzKey(key: number[]): boolean {
  if (key.length !== 44) return false;
  return key.every((w, i) => {
    let t = w >>> 0;
    t ^= t >>> 16;
    t ^= t >>> 8;
    t ^= t >>> 4;
    t ^= t >>> 2;
    t ^= t >>> 1;
    return (~t & 1) === PARITY[i];
  });
}

/** Parses "0x1234abcd 0x..." / comma / newline separated key text into 44 words. */
export function parseFzKey(text: string): number[] {
  return (text.match(/(?:0x)?[0-9a-f]{1,8}/gi) ?? []).map((h) => parseInt(h.replace(/^0x/i, ''), 16) >>> 0);
}

export function rc6Decode(src: Uint8Array, key: number[]): Uint8Array {
  const out = new Uint8Array(src.length);
  const ibuf = new Uint8Array(16);
  let A = 0, B = 0, C = 0, D = 0;
  const r = 20;
  for (let pos = 0; pos < src.length; pos++) {
    B = (B + key[0]) >>> 0;
    D = (D + key[1]) >>> 0;
    for (let i = 1; i <= r; i++) {
      const t = rotl(Math.imul(B, (2 * B + 1) >>> 0) >>> 0, 5);
      const u = rotl(Math.imul(D, (2 * D + 1) >>> 0) >>> 0, 5);
      A = (rotl((A ^ t) >>> 0, u & 31) + key[2 * i]) >>> 0;
      C = (rotl((C ^ u) >>> 0, t & 31) + key[2 * i + 1]) >>> 0;
      const tmp = A;
      A = B;
      B = C;
      C = D;
      D = tmp;
    }
    A = (A + key[2 * r + 2]) >>> 0;
    const cur = src[pos];
    out[pos] = (cur ^ (A & 0xff)) & 0xff;
    ibuf.copyWithin(0, 1);
    ibuf[15] = cur;
    A = (ibuf[0] | (ibuf[1] << 8) | (ibuf[2] << 16) | (ibuf[3] << 24)) >>> 0;
    B = (ibuf[4] | (ibuf[5] << 8) | (ibuf[6] << 16) | (ibuf[7] << 24)) >>> 0;
    C = (ibuf[8] | (ibuf[9] << 8) | (ibuf[10] << 16) | (ibuf[11] << 24)) >>> 0;
    D = (ibuf[12] | (ibuf[13] << 8) | (ibuf[14] << 16) | (ibuf[15] << 24)) >>> 0;
  }
  return out;
}
