import type { RawBoard, RawPart, RawPin } from '../core/types';
import { chainSegments, type Segment } from '../core/geometry';
import { checkXzzKey, desDecryptECB, desKeySchedule, parseDesKey } from '../crypto/des';
import { u32le } from './text';

/**
 * XZZ `.pcb` (XinZhiZao) — binary, partially XOR-obfuscated, with DES-encrypted
 * part blocks. The DES key is user-supplied.
 */

const SCALE = 10000;
const MAGIC = 'XZZPCB';
const TAIL = 'v6v6555v6v6';

export function isXZZ(d: Uint8Array): boolean {
  if (d.length < 0x11) return false;
  const head = (xor: number) => String.fromCharCode(...Array.from(d.subarray(0, 6), (b) => b ^ xor));
  return head(0) === MAGIC || (d[0x10] !== 0 && head(d[0x10]) === MAGIC);
}

function indexOfAscii(d: Uint8Array, s: string): number {
  outer: for (let i = 0; i <= d.length - s.length; i++) {
    for (let j = 0; j < s.length; j++) if (d[i + j] !== s.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

export function parseXZZ(input: Uint8Array, keyHex?: string): RawBoard {
  const key = keyHex ? parseDesKey(keyHex) : null;
  if (!key || !checkXzzKey(key)) {
    throw new Error('Este .pcb XZZ requiere su clave DES (16 hex). Configúrala en Ajustes → Claves de formato.');
  }
  const subkeys = desKeySchedule(key);
  const buf = new Uint8Array(input);
  const dec = new TextDecoder('utf-8');

  if (buf[0x10] !== 0) {
    const xor = buf[0x10];
    let end = indexOfAscii(buf, TAIL);
    if (end < 0) end = buf.length;
    for (let i = 0; i < end; i++) buf[i] ^= xor;
  }

  const mainStart = u32le(buf, 0x20) + 0x20;
  const netStart = u32le(buf, 0x28) + 0x20;
  const mainSize = u32le(buf, mainStart);
  const netSize = u32le(buf, netStart);

  // Net dictionary
  const nets = new Map<number, string>();
  {
    const nb = buf.subarray(netStart + 4, netStart + 4 + netSize);
    let p = 0;
    while (p + 8 <= nb.length) {
      const size = u32le(nb, p);
      const idx = u32le(nb, p + 4);
      p += 8;
      nets.set(idx, dec.decode(nb.subarray(p, p + size - 8)));
      p += size - 8;
      if (size < 8) break;
    }
  }

  const parts: RawPart[] = [];
  const pins: RawPin[] = [];
  const segs: Segment[] = [];
  const netName = (i: number) => {
    const n = nets.get(i) ?? '';
    return n === 'NC' ? 'UNCONNECTED' : n;
  };

  const arc = (b: Uint8Array) => {
    if (u32le(b, 0) !== 28) return;
    const x = u32le(b, 4) / SCALE, y = u32le(b, 8) / SCALE, r = u32le(b, 12) / SCALE;
    let a0 = Math.trunc(u32le(b, 16) / SCALE), a1 = Math.trunc(u32le(b, 20) / SCALE);
    if (a0 > a1) [a0, a1] = [a1, a0];
    if (a1 - a0 > 180) a0 += 360;
    const N = 10;
    const toRad = Math.PI / 180;
    let prev = { x: Math.trunc(x + r * Math.cos(a0 * toRad)), y: Math.trunc(y + r * Math.sin(a0 * toRad)) };
    for (let i = 1; i < N; i++) {
      const a = (a0 + ((a1 - a0) * i) / (N - 1)) * toRad;
      const p = { x: Math.trunc(x + r * Math.cos(a)), y: Math.trunc(y + r * Math.sin(a)) };
      segs.push([prev, p]);
      prev = p;
    }
  };

  const line = (b: Uint8Array) => {
    if (u32le(b, 0) !== 28) return;
    segs.push([
      { x: Math.trunc(u32le(b, 4) / SCALE), y: Math.trunc(u32le(b, 8) / SCALE) },
      { x: Math.trunc(u32le(b, 12) / SCALE), y: Math.trunc(u32le(b, 16) / SCALE) },
    ]);
  };

  const part = (enc: Uint8Array) => {
    const b = desDecryptECB(enc, subkeys);
    let p = 0;
    const partSize = u32le(b, p);
    p += 4 + 18;
    const groupLen = u32le(b, p);
    p += 4 + groupLen;
    if (b[p] !== 0x06) throw new Error('XZZ: bloque de componente inesperado (¿clave incorrecta?)');
    p += 31;
    const nameLen = u32le(b, p);
    p += 4;
    const name = dec.decode(b.subarray(p, p + nameLen));
    p += nameLen;
    const idx = parts.length + 1;
    while (p < partSize + 4 && p < b.length) {
      const t = b[p++];
      if (t === 0x01 || t === 0x05 || t === 0x06) {
        p += u32le(b, p) + 4;
      } else if (t === 0x09) {
        const size = u32le(b, p);
        const end = p + size + 4;
        let q = p + 8;
        const x = u32le(b, q) / SCALE; q += 4;
        const y = u32le(b, q) / SCALE; q += 4 + 8;
        const pnLen = u32le(b, q); q += 4;
        const pname = dec.decode(b.subarray(q, q + pnLen)); q += pnLen + 32;
        const net = netName(u32le(b, q));
        pins.push({ part: idx, x: Math.trunc(x), y: Math.trunc(y), num: pname, net, side: 'top' });
        p = end;
      }
    }
    parts.push({ name, side: 'top', smd: true });
  };

  const testPad = (b: Uint8Array) => {
    const x = Math.trunc(u32le(b, 4) / SCALE);
    const y = Math.trunc(u32le(b, 8) / SCALE);
    const nameLen = u32le(b, 20);
    const name = dec.decode(b.subarray(24, 24 + nameLen));
    const n = nets.get(u32le(b, b.length - 4)) ?? '';
    parts.push({ name: `TP·${name}`, side: 'top', smd: true });
    pins.push({ part: parts.length, x, y, num: name, net: n === 'NC' || n === 'UNCONNECTED' ? '' : n, side: 'top' });
  };

  let p = mainStart + 4;
  const end = mainStart + 4 + mainSize;
  while (p < end) {
    const type = buf[p];
    const size = u32le(buf, p + 1);
    p += 5;
    const block = buf.subarray(p, p + size);
    p += size;
    if (type === 0x01) arc(block);
    else if (type === 0x05) line(block);
    else if (type === 0x07) part(block);
    else if (type === 0x09) testPad(block);
  }

  // Normalise origin to the outline's minimum corner.
  if (segs.length) {
    let mx = Infinity, my = Infinity;
    for (const [a, b] of segs) {
      mx = Math.min(mx, a.x, b.x);
      my = Math.min(my, a.y, b.y);
    }
    for (const s of segs) for (const pt of s) { pt.x -= mx; pt.y -= my; }
    for (const pin of pins) { pin.x -= mx; pin.y -= my; }
  }

  return { format: 'XZZ', outline: chainSegments(segs), parts, pins, nails: [] };
}
