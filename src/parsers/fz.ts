import { inflateSync } from 'fflate';
import type { RawBoard, Side } from '../core/types';
import { checkFzKey, rc6Decode } from '../crypto/rc6';
import { Fields, decodeText, splitLines } from './text';

/**
 * ASUS `.fz`: [4 bytes][zlib content][zlib description][u32 descr length].
 * Most files are RC6 encrypted (user key required); some ship as plain zlib.
 */

export function isFZ(d: Uint8Array, name: string): boolean {
  return /\.fz$/i.test(name) || isPlainFZ(d);
}

function isPlainFZ(d: Uint8Array): boolean {
  return d.length > 8 && d[4] === 0x78 && (d[5] === 0x9c || d[5] === 0xda || d[5] === 0x01 || d[5] === 0x5e);
}

/** Inflate a zlib stream while tolerating trailing garbage. */
function inflateZ(d: Uint8Array): Uint8Array {
  if (d.length < 3 || d[0] !== 0x78) throw new Error('Flujo zlib inválido');
  return inflateSync(d.subarray(2));
}

export function parseFZ(data: Uint8Array, key?: number[]): RawBoard {
  let buf = data;
  if (!isPlainFZ(data)) {
    if (!key || !checkFzKey(key)) {
      throw new Error(
        'Este .fz está cifrado (RC6). Introduce la clave FZ de 44 palabras en Ajustes → Claves de formato.',
      );
    }
    buf = rc6Decode(data, key);
  }
  const n = buf.length;
  const descrLen = (buf[n - 4] | (buf[n - 3] << 8) | (buf[n - 2] << 16) | (buf[n - 1] << 24)) >>> 0;
  if (descrLen > n) throw new Error('FZ: longitud de descripción inválida (¿clave incorrecta?)');
  const contentEnd = n - descrLen + 4;
  let content: string;
  let descr = '';
  try {
    content = decodeText(inflateZ(buf.subarray(4, contentEnd)));
  } catch {
    throw new Error('FZ: no se pudo descomprimir el contenido (¿clave incorrecta?)');
  }
  try {
    descr = decodeText(inflateZ(buf.subarray(contentEnd)));
  } catch {
    /* description block is optional */
  }
  return parseFZContent(content.replace(/,/g, '.'), descr);
}

export function parseFZContent(content: string, descr: string): RawBoard {
  const board: RawBoard = { format: 'FZ', outline: [], parts: [], pins: [], nails: [] };
  const ids = new Map<string, number>();
  let mult = 1;
  let block = 0;

  for (const raw of splitLines(content)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'UNIT:millimeters') mult = 1000 / 25.4;
    if (line[0] === 'A') {
      const h = line.slice(2);
      block = h.startsWith('REFDES') ? 1 : h.startsWith('NET_NAME') ? 2 : h.startsWith('TESTVIA') ? 3 : -1;
      continue;
    }
    if (line[0] !== 'S') continue;
    const f = new Fields(line.slice(2), '!');
    if (block === 1) {
      const name = f.str();
      f.str(); f.str();
      const mirror = f.str();
      board.parts.push({ name, smd: true, side: mirror === 'YES' ? 'bottom' : 'top' });
      ids.set(name, board.parts.length);
    } else if (block === 2) {
      const net = f.str();
      const part = ids.get(f.str()) ?? 0;
      const snum = f.str();
      const pname = f.str();
      const usePname = snum.length <= 1 && (snum === '' || snum === '0');
      const x = f.num() * mult;
      const y = f.num() * mult;
      const probe = f.int();
      let r = f.num() / 100;
      if (r < 0.5) r = 0.5;
      board.pins.push({
        net,
        part,
        num: usePname ? pname : snum,
        name: usePname ? undefined : pname,
        x,
        y,
        probe,
        radius: r * mult,
        side: board.parts[part - 1]?.side ?? 'both',
      });
    } else if (block === 3) {
      f.skip(2); // "Y!"
      const net = f.str();
      f.str(); f.int(); f.str();
      const x = f.num() * mult;
      const y = f.num() * mult;
      const side: Side = f.str() === 'T' ? 'top' : 'bottom';
      board.nails.push({ x, y, net, side });
    }
  }
  if (!board.parts.length) throw new Error('FZ: no se encontraron componentes (¿clave incorrecta?)');

  // Description table: partno \t description \t qty \t locations \t partno2
  const dl = splitLines(descr);
  for (let i = 2; i < dl.length; i++) {
    const line = dl[i].trim();
    if (!line || line[0] === 's') continue;
    const cols = line.split('\t');
    const description = cols[1]?.trim();
    if (!description) continue;
    for (const loc of (cols[3] ?? '').split(/[,\s]+/)) {
      const id = ids.get(loc);
      if (id) board.parts[id - 1].mfg = `${cols[0].trim()} · ${description}`;
    }
  }
  return board;
}
