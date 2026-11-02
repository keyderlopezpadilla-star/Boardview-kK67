import type { RawBoard, RawPart, Side } from '../core/types';
import { i16le } from './text';

/** CST (Castw binary) — reverse-engineered layout; outline is synthesised from pins. */
export function isCST(d: Uint8Array, name: string): boolean {
  return /\.cst$/i.test(name) && d.length > 32;
}

export function parseCST(d: Uint8Array): RawBoard {
  const dec = new TextDecoder('windows-1252');
  let p = 0;
  const str = (n: number) => {
    const s = dec.decode(d.subarray(p, p + n));
    p += n;
    return s;
  };
  const sbyte = () => {
    const v = d[p++];
    return v > 127 ? v - 256 : v;
  };
  const short = () => {
    const v = i16le(d, p);
    p += 2;
    return v;
  };

  const numParts = short();
  p += 4;
  str(short());
  const parts: RawPart[] = [];
  for (let i = 0; i < numParts; i++) {
    const name = str(sbyte());
    p += 4;
    const layer = sbyte();
    const side: Side = layer === 0x0c ? 'top' : layer === 0x01 ? 'bottom' : 'both';
    parts.push({ name, side, smd: true });
    p += 6;
  }
  p -= 2;
  const numNets = short();
  const nets: string[] = [];
  for (let i = 0; i < numNets; i++) nets.push(str(sbyte()));

  parts.push({ name: '...', side: 'both', smd: false });
  const dummy = parts.length;

  const sig = [0x43, 0x50, 0x61, 0x64]; // "CPad"
  while (p < d.length - 4 && !(d[p] === sig[0] && d[p + 1] === sig[1] && d[p + 2] === sig[2] && d[p + 3] === sig[3])) p++;
  if (p >= d.length - 4) throw new Error('CST: sección CPad no encontrada');
  p -= 8;
  const numPins = short();
  p += 10;

  const pins: RawBoard['pins'] = [];
  for (let i = 0; i < numPins && p + 16 <= d.length; i++) {
    const partId = short();
    const probe = short();
    const netId = short();
    const x = short();
    const y = short();
    short(); // shape id
    p += 4;
    const part = partId >= 0 ? partId + 1 : dummy;
    pins.push({ part, probe, x, y, net: nets[netId] ?? '', side: parts[part - 1]?.side ?? 'both' });
  }
  return { format: 'CST', outline: [], parts, pins, nails: [] };
}
