import { unzipSync } from 'fflate';
import type { InputFile, ParseKeys, RawBoard } from '../core/types';
import { isBDV, parseASC, parseBDV, type AscSet } from './asc';
import { isBRD, isBRD2, parseBRD, parseBRD2 } from './brd';
import { isBVR1, isBVR3, parseBVR1, parseBVR3 } from './bvr';
import { isPanelCAD, parsePanelCAD } from './cad';
import { isCST, parseCST } from './cst';
import { isFZ, parseFZ } from './fz';
import { isGenCAD, parseGenCAD } from './gencad';
import { isXZZ, parseXZZ } from './xzz';

export const SUPPORTED_EXTENSIONS = [
  '.brd', '.bdv', '.asc', '.bvr', '.bv', '.cad', '.gcd', '.gencad', '.cst', '.fz', '.pcb', '.zip', '.pdf',
];

interface Detector {
  id: string;
  test: (d: Uint8Array, name: string) => boolean;
  parse: (d: Uint8Array, keys: ParseKeys) => RawBoard;
}

/** Order matters: content signatures first, extension-only heuristics last. */
const DETECTORS: Detector[] = [
  { id: 'XZZ', test: (d) => isXZZ(d), parse: (d, k) => parseXZZ(d, k.xzz) },
  { id: 'BRD2', test: (d) => isBRD2(d), parse: (d) => parseBRD2(d) },
  { id: 'BRD', test: (d) => isBRD(d), parse: (d) => parseBRD(d) },
  { id: 'BVR3', test: (d) => isBVR3(d), parse: (d) => parseBVR3(d) },
  { id: 'BVR', test: (d) => isBVR1(d), parse: (d) => parseBVR1(d) },
  { id: 'GenCAD', test: (d) => isGenCAD(d), parse: (d) => parseGenCAD(d) },
  { id: 'CAD', test: (d) => isPanelCAD(d), parse: (d) => parsePanelCAD(d) },
  { id: 'BDV', test: (d) => isBDV(d), parse: (d) => parseBDV(d) },
  { id: 'FZ', test: (d, n) => isFZ(d, n), parse: (d, k) => parseFZ(d, k.fz) },
  { id: 'CST', test: (d, n) => isCST(d, n), parse: (d) => parseCST(d) },
];

const base = (n: string) => n.split(/[\\/]/).pop()!.toLowerCase();
const isPdf = (f: InputFile) => /\.pdf$/i.test(f.name) || (f.data[0] === 0x25 && f.data[1] === 0x50 && f.data[2] === 0x44 && f.data[3] === 0x46);
const isZip = (f: InputFile) => f.data[0] === 0x50 && f.data[1] === 0x4b && f.data[2] === 0x03 && f.data[3] === 0x04;

/** Expands archives recursively (zip inside zip is common on repair forums). */
export function expandArchives(files: InputFile[], depth = 0): InputFile[] {
  const out: InputFile[] = [];
  for (const f of files) {
    if (isZip(f) && depth < 3) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(f.data);
      } catch (e) {
        throw new Error(`No se pudo abrir el ZIP "${f.name}": ${(e as Error).message}. Los ZIP cifrados con contraseña no están soportados.`);
      }
      const inner = Object.entries(entries)
        .filter(([n, d]) => !n.endsWith('/') && d.length > 0 && !/(^|\/)__MACOSX\//.test(n))
        .map(([name, data]) => ({ name, data }));
      out.push(...expandArchives(inner, depth + 1));
    } else {
      out.push(f);
    }
  }
  return out;
}

export interface Classified {
  boards: InputFile[];
  asc: AscSet | null;
  pdfs: InputFile[];
}

export function classify(files: InputFile[]): Classified {
  const boards: InputFile[] = [];
  const pdfs: InputFile[] = [];
  const asc: AscSet = {};
  for (const f of files) {
    const n = base(f.name);
    if (isPdf(f)) pdfs.push(f);
    else if (n === 'format.asc') asc.format = f.data;
    else if (n === 'pins.asc') asc.pins = f.data;
    else if (n === 'nails.asc') asc.nails = f.data;
    else if (/\.(asc|bom|txt|nfo|url|htm|html|jpg|png|gif|exe|dll|ini)$/i.test(n)) continue;
    else if (DETECTORS.some((d) => d.test(f.data, f.name))) boards.push(f);
  }
  return { boards, asc: asc.pins ? asc : null, pdfs };
}

export function parseBoardFile(file: InputFile, keys: ParseKeys): RawBoard {
  for (const d of DETECTORS) {
    if (d.test(file.data, file.name)) return d.parse(file.data, keys);
  }
  throw new Error(`Formato no reconocido: ${file.name}`);
}

export { parseASC };
