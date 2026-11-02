import type { RawBoard, Side } from '../core/types';
import { Fields, bytesInclude, decodeText, splitLines } from './text';

/** Panel-style `.cad` (Teboview export: COMP / C_PIN / NET / N_VIA records). */
export function isPanelCAD(d: Uint8Array): boolean {
  return bytesInclude(d, '###Panel Added') && bytesInclude(d, 'C_PIN');
}

const stripSlash = (n: string) => (n.includes('/') ? n.slice(1) : n);

export function parsePanelCAD(data: Uint8Array): RawBoard {
  const board: RawBoard = { format: 'CAD', outline: [], parts: [], pins: [], nails: [] };
  const ids = new Map<string, number>();
  let viaNet = '';
  for (const raw of splitLines(decodeText(data))) {
    const line = raw.trim();
    if (!line) continue;
    const f = new Fields(line);
    if (line.startsWith('COMP')) {
      f.str();
      const name = f.str();
      for (let i = 0; i < 5; i++) f.str();
      const side: Side = f.str() === '1' ? 'top' : 'bottom';
      board.parts.push({ name, side, smd: true });
      ids.set(name, board.parts.length);
    } else if (line.startsWith('C_PIN')) {
      f.str();
      const ref = f.str();
      const dash = ref.indexOf('-');
      const partName = dash >= 0 ? ref.slice(0, dash) : ref;
      const num = dash >= 0 ? ref.slice(dash + 1) : undefined;
      const part = ids.get(partName) ?? 0;
      const x = f.num() * 1000;
      const y = f.num() * 1000;
      f.num(); f.num(); f.num(); f.str();
      board.pins.push({ part, num, x, y, net: stripSlash(f.str()), side: board.parts[part - 1]?.side ?? 'both' });
    } else if (line.startsWith('NET ')) {
      f.str();
      viaNet = stripSlash(f.str());
    } else if (line.startsWith('N_VIA')) {
      f.str();
      const x = f.num() * 1000;
      const y = f.num() * 1000;
      f.str();
      board.nails.push({ x, y, net: viaNet, side: f.num() === 1 ? 'top' : 'bottom' });
    }
  }
  if (!board.parts.length) throw new Error('Archivo CAD sin componentes');
  return board;
}
