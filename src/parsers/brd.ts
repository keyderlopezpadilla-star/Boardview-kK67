import type { RawBoard, RawNail, RawPart, RawPin, Side } from '../core/types';
import { Fields, bytesInclude, decodeText, splitLines, startsWithBytes } from './text';

const BRD_ENCODED_SIG = [0x23, 0xe2, 0x63, 0x28];

export function isBRD(d: Uint8Array): boolean {
  return startsWithBytes(d, BRD_ENCODED_SIG) || (bytesInclude(d, 'str_length:') && bytesInclude(d, 'var_data:'));
}

export function isBRD2(d: Uint8Array): boolean {
  return bytesInclude(d, 'BRDOUT:') && bytesInclude(d, 'NETS:');
}

/** Reverses the trivial bit-rotation obfuscation used by "encoded" .brd files. */
export function decodeBRD(d: Uint8Array): Uint8Array {
  if (!startsWithBytes(d, BRD_ENCODED_SIG)) return d;
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) {
    const b = d[i];
    out[i] = b === 13 || b === 10 || b === 0 ? b : ~(((b >> 6) & 3) | (b << 2)) & 0xff;
  }
  return out;
}

/** Inverse of {@link decodeBRD}; used by tests and the demo generator. */
export function encodeBRD(d: Uint8Array): Uint8Array {
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) {
    const b = d[i];
    if (b === 13 || b === 10 || b === 0) { out[i] = b; continue; }
    const v = ~b & 0xff; // v = rotl2(original)
    out[i] = ((v >> 2) | (v << 6)) & 0xff;
  }
  return out;
}

const sideFromType = (t: number): Side => (t === 1 || (t >= 4 && t < 8) ? 'top' : t === 2 || t >= 8 ? 'bottom' : 'both');

export function parseBRD(data: Uint8Array): RawBoard {
  const lines = splitLines(decodeText(decodeBRD(data)));
  const board: RawBoard = { format: 'BRD', outline: [], parts: [], pins: [], nails: [] };
  const fmt: { x: number; y: number }[] = [];
  let block = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    switch (line) {
      case 'str_length:': block = 1; continue;
      case 'var_data:': block = 2; continue;
      case 'Format:': case 'format:': block = 3; continue;
      case 'Parts:': case 'Pins1:': block = 4; continue;
      case 'Pins:': case 'Pins2:': block = 5; continue;
      case 'Nails:': block = 6; continue;
    }
    const f = new Fields(line);
    switch (block) {
      case 3:
        fmt.push({ x: f.int(), y: f.int() });
        break;
      case 4: {
        const name = f.str();
        const type = f.int();
        f.int(); // end_of_pins — pins carry their part index explicitly
        board.parts.push({ name, side: sideFromType(type), smd: (type & 0xc) !== 0 });
        break;
      }
      case 5: {
        const x = f.int();
        const y = f.int();
        const probe = f.int();
        const part = f.int();
        const net = f.str();
        board.pins.push({ x, y, probe, part, net, side: 'top' });
        break;
      }
      case 6: {
        const probe = f.int();
        const x = f.int();
        const y = f.int();
        const side: Side = f.int() === 1 ? 'top' : 'bottom';
        board.nails.push({ probe, x, y, side, net: f.str() });
        break;
      }
    }
  }
  if (block === 0) throw new Error('El archivo no contiene secciones BRD reconocibles');

  // Lenovo variant: pins without net names inherit them from the nail with the same probe.
  const byProbe = new Map<number, string>();
  for (const n of board.nails) byProbe.set(n.probe ?? -1, n.net);
  for (const p of board.pins) {
    if (!p.net) p.net = byProbe.get(p.probe ?? -999) ?? '';
    p.side = board.parts[p.part - 1]?.side ?? 'both';
  }
  if (fmt.length) board.outline.push(fmt);
  return board;
}

/** BRD2 ("BRDOUT:") — the format exported by several Gigabyte / MSI tools. */
export function parseBRD2(data: Uint8Array): RawBoard {
  const lines = splitLines(decodeText(data));
  const nets = new Map<number, string>();
  const fmt: { x: number; y: number }[] = [];
  const parts: (RawPart & { firstPin: number })[] = [];
  const pins: RawPin[] = [];
  const nails: RawNail[] = [];
  let maxY = 0;
  let block = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^(BRDOUT|NETS|PARTS|PINS|NAILS):/.exec(line);
    if (head) {
      const f = new Fields(line.slice(head[0].length));
      block = ['BRDOUT', 'NETS', 'PARTS', 'PINS', 'NAILS'].indexOf(head[1]) + 1;
      if (block === 1) { f.int(); f.int(); maxY = f.int(); }
      continue;
    }
    const f = new Fields(line);
    switch (block) {
      case 1: fmt.push({ x: f.int(), y: f.int() }); break;
      case 2: { const id = f.int(); nets.set(id, f.str()); break; }
      case 3: {
        const name = f.str();
        f.int(); f.int(); f.int(); f.int(); // p1/p2 bbox, recomputed later
        const firstPin = f.int();
        const s = f.int();
        parts.push({ name, firstPin, smd: true, side: s === 1 ? 'top' : s === 2 ? 'bottom' : 'both' });
        break;
      }
      case 4: {
        const x = f.int();
        const y = f.int();
        const net = nets.get(f.int()) ?? '';
        const s = f.int();
        pins.push({ x, y, net, part: 0, side: s === 1 ? 'top' : s === 2 ? 'bottom' : 'both' });
        break;
      }
      case 5: {
        const probe = f.int();
        const x = f.int();
        let y = f.int();
        const net = nets.get(f.int()) ?? 'UNCONNECTED';
        const top = f.int() === 1;
        if (!top) y = maxY - y;
        nails.push({ probe, x, y, net, side: top ? 'top' : 'bottom' });
        break;
      }
    }
  }
  if (!block) throw new Error('Archivo BRD2 inválido');

  let cpi = 0;
  parts.forEach((part, i) => {
    const end = i === parts.length - 1 ? pins.length : parts[i + 1].firstPin;
    let isDip = true;
    while (cpi < end && cpi < pins.length) {
      const pin = pins[cpi];
      pin.part = i + 1;
      if (pin.side !== 'top') pin.y = maxY - pin.y;
      if (pin.side === part.side) isDip = false;
      cpi++;
    }
    if (isDip) { part.smd = false; part.side = 'both'; }
  });

  return {
    format: 'BRD2',
    outline: fmt.length ? [fmt] : [],
    parts: parts.map(({ firstPin: _f, ...p }) => p),
    pins,
    nails,
  };
}
