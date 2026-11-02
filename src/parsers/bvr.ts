import type { RawBoard, RawPart, RawPin, Side } from '../core/types';
import { chainSegments, type Segment } from '../core/geometry';
import { Fields, bytesInclude, decodeText, splitLines } from './text';

export const isBVR1 = (d: Uint8Array) => bytesInclude(d, 'BVRAW_FORMAT_1', 4096);
export const isBVR3 = (d: Uint8Array) => bytesInclude(d, 'BVRAW_FORMAT_3', 4096);

const sideTB = (s: string): Side => (s === 'T' ? 'top' : s === 'B' ? 'bottom' : 'both');

/** BVRAW_FORMAT_1: tab-separated tables with `<<Layout>>`, `<<Pin>>`, `<<Nail>>` sections. */
export function parseBVR1(data: Uint8Array): RawBoard {
  const board: RawBoard = { format: 'BVR', outline: [], parts: [], pins: [], nails: [] };
  const fmt: { x: number; y: number }[] = [];
  let block = 0;
  let skip = 0;
  let prevPart = '';
  for (const raw of splitLines(decodeText(data))) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '<<Layout>>') { block = 1; skip = 1; continue; }
    if (line === '<<Pin>>') { block = 2; skip = 1; continue; }
    if (line === '<<Nail>>') { block = 3; skip = 1; continue; }
    if (skip) { skip--; continue; }
    if (block === 1) {
      const f = new Fields(line.replace(',', ' '));
      fmt.push({ x: Math.trunc(f.num() * 1000), y: Math.trunc(f.num() * 1000) });
    } else if (block === 2) {
      const f = new Fields(line);
      const name = f.str();
      const side: Side = f.str() === '(T)' ? 'top' : 'bottom';
      if (name !== prevPart) {
        board.parts.push({ name, side, smd: true });
        prevPart = name;
      }
      f.int();
      const num = f.str();
      const x = Math.trunc(f.num() * 1000);
      const y = Math.trunc(f.num() * 1000);
      f.int();
      board.pins.push({ part: board.parts.length, num, x, y, net: f.str(), side });
    } else if (block === 3) {
      const cols = line.split('\t');
      const f = new Fields(cols.slice(1).join('\t'));
      const x = f.num() * 1000;
      const y = f.num() * 1000;
      f.int();
      f.str();
      const side: Side = f.str() === '(T)' ? 'top' : 'bottom';
      f.str();
      board.nails.push({ x, y, side, net: f.str() });
    }
  }
  if (!block) throw new Error('Archivo BVR inválido');
  if (fmt.length) board.outline.push(fmt);
  return board;
}

/** BVRAW_FORMAT_3: verbose key/value records (PART_* / PIN_* / OUTLINE_*). */
export function parseBVR3(data: Uint8Array): RawBoard {
  const parts: RawPart[] = [];
  const pins: RawPin[] = [];
  const outline: { x: number; y: number }[][] = [];
  const segments: Segment[] = [];
  let part: RawPart & { ox: number; oy: number } = { name: '', side: 'top', smd: true, ox: 0, oy: 0 };
  let pin: RawPin = { x: 0, y: 0, part: 0, net: '', side: 'top' };

  for (const raw of splitLines(decodeText(data))) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    const f = new Fields(sp < 0 ? '' : line.slice(sp + 1));
    switch (key) {
      case 'PART_NAME': part.name = f.str(); break;
      case 'PART_SIDE': part.side = sideTB(f.str()); break;
      case 'PART_ORIGIN': part.ox = Math.trunc(f.num()); part.oy = Math.trunc(f.num()); break;
      case 'PART_MOUNT': part.smd = f.str() === 'SMD'; break;
      case 'PIN_NUMBER': pin.num = f.str(); break;
      case 'PIN_NAME': pin.name = f.str(); break;
      case 'PIN_SIDE': pin.side = sideTB(f.str()); break;
      case 'PIN_ORIGIN':
        pin.x = Math.trunc(f.num()) + part.ox;
        pin.y = Math.trunc(f.num()) + part.oy;
        break;
      case 'PIN_RADIUS': pin.radius = f.num(); break;
      case 'PIN_NET': pin.net = f.str(); break;
      case 'PIN_END':
        pin.part = parts.length + 1;
        pins.push(pin);
        pin = { x: 0, y: 0, part: 0, net: '', side: 'top' };
        break;
      case 'PART_END': {
        const { ox: _x, oy: _y, ...p } = part;
        parts.push(p);
        part = { name: '', side: 'top', smd: true, ox: 0, oy: 0 };
        break;
      }
      case 'OUTLINE_POINTS': {
        const pts: { x: number; y: number }[] = [];
        while (f.more) pts.push({ x: Math.trunc(f.num()), y: Math.trunc(f.num()) });
        if (pts.length) outline.push(pts);
        break;
      }
      case 'OUTLINE_SEGMENTED':
        while (f.more) {
          const before = f.pos;
          const a = { x: Math.trunc(f.num()), y: Math.trunc(f.num()) };
          const b = { x: Math.trunc(f.num()), y: Math.trunc(f.num()) };
          if (f.pos === before) break;
          segments.push([a, b]);
        }
        break;
    }
  }
  if (segments.length) outline.push(...chainSegments(segments));
  if (!parts.length && !outline.length) throw new Error('Archivo BVR3 sin datos');
  return { format: 'BVR3', outline, parts, pins, nails: [] };
}
