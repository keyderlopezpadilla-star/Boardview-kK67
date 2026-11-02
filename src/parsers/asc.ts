import type { RawBoard, Side } from '../core/types';
import { Fields, bytesInclude, decodeText, splitLines } from './text';

/**
 * TSICT ASCII family: ASUS/Pegatron `format.asc` + `pins.asc` + `nails.asc`
 * and the HONHAN `.bdv` container which embeds those three sections in a
 * lightly obfuscated single file.
 *
 * Instead of skipping a hard-coded number of header lines (fragile), every
 * data line is validated against its expected shape.
 */

export function isBDV(d: Uint8Array): boolean {
  const probe = decodeBDV(d.subarray(0, Math.min(d.length, 1 << 16)));
  return (
    bytesInclude(d, 'dd:1.3?,r?-=bb') ||
    (bytesInclude(probe, '<<format.asc>>') && bytesInclude(probe, '<<pins.asc>>'))
  );
}

export function decodeBDV(src: Uint8Array): Uint8Array {
  const buf = new Uint8Array(src);
  let count = 0xa0;
  for (let i = 0; i < buf.length; i++) {
    if (src[i] === 13 && src[i + 1] === 10) count++;
    const x = src[i];
    if (!(x === 13 || x === 10 || x === 0)) {
      const signed = x > 127 ? x - 256 : x;
      buf[i] = (count - signed) & 0xff;
    }
    if (count > 285) count = 159;
  }
  return buf;
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INT = /^[+-]?\d+$/;
const locSide = (s: string): Side => (s === '(T)' ? 'top' : 'bottom');

interface AscState {
  board: RawBoard;
  fmt: { x: number; y: number }[];
}

function newState(format: string): AscState {
  return { board: { format, outline: [], parts: [], pins: [], nails: [] }, fmt: [] };
}

function formatLine(st: AscState, line: string): void {
  const t = line.split(/\s+/);
  if (t.length < 2 || !NUM.test(t[0]) || !NUM.test(t[1])) return;
  st.fmt.push({ x: parseFloat(t[0]) * 1000, y: parseFloat(t[1]) * 1000 });
}

function pinLine(st: AscState, line: string): void {
  const { parts, pins } = st.board;
  if (line.startsWith('Part')) {
    const f = new Fields(line.slice(4));
    const name = f.str();
    if (!name) return;
    parts.push({ name, smd: true, side: locSide(f.str()) });
    return;
  }
  if (!parts.length) return;
  const t = line.split(/\s+/);
  // id  name  x  y  layer  net  probe
  if (t.length < 6 || !INT.test(t[0]) || !NUM.test(t[2]) || !NUM.test(t[3])) return;
  const part = parts.length;
  pins.push({
    part,
    num: t[1],
    x: parseFloat(t[2]) * 1000,
    y: parseFloat(t[3]) * 1000,
    net: t[5],
    probe: t[6] && INT.test(t[6]) ? parseInt(t[6], 10) : undefined,
    side: parts[part - 1].side,
  });
}

function nailLine(st: AscState, line: string): void {
  // $probe  x  y  type  grid  (T|B)  netid  net
  const f = new Fields(line.slice(1));
  const t = line.slice(1).split(/\s+/);
  if (t.length < 8 || !INT.test(t[0]) || !NUM.test(t[1]) || !NUM.test(t[2])) return;
  const probe = f.int();
  const x = f.num() * 1000;
  const y = f.num() * 1000;
  st.board.nails.push({ probe, x, y, side: locSide(t[5]), net: t[7] });
}

function finish(st: AscState): RawBoard {
  if (st.fmt.length) st.board.outline.push(st.fmt);
  if (!st.board.pins.length && !st.board.parts.length) throw new Error('No se encontraron componentes en los archivos ASC');
  return st.board;
}

export function parseBDV(data: Uint8Array): RawBoard {
  const lines = splitLines(decodeText(decodeBDV(data)));
  const st = newState('BDV');
  let block = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '<<format.asc>>') { block = 1; continue; }
    if (line === '<<pins.asc>>') { block = 2; continue; }
    if (line === '<<nails.asc>>') { block = 3; continue; }
    if (line.startsWith('<<')) { block = 0; continue; }
    if (block === 1) formatLine(st, line);
    else if (block === 2) pinLine(st, line);
    else if (block === 3) nailLine(st, line);
  }
  return finish(st);
}

export interface AscSet {
  format?: Uint8Array;
  pins?: Uint8Array;
  nails?: Uint8Array;
}

export function parseASC(set: AscSet): RawBoard {
  if (!set.pins) throw new Error('Falta pins.asc: el formato ASC requiere format.asc, pins.asc y nails.asc');
  const st = newState('ASC');
  const each = (d: Uint8Array | undefined, fn: (s: AscState, l: string) => void) => {
    if (!d) return;
    for (const raw of splitLines(decodeText(d))) {
      const line = raw.trim();
      if (line) fn(st, line);
    }
  };
  each(set.format, formatLine);
  each(set.pins, pinLine);
  each(set.nails, nailLine);
  return finish(st);
}
