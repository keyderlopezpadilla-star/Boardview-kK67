import type { Pt, RawBoard, RawNail, RawPart, RawPin, Side } from '../core/types';
import { arcPoints, chainSegments, pointsToSegments, type Segment } from '../core/geometry';
import { bytesInclude, decodeText, splitLines } from './text';

/**
 * GenCAD 1.4 (.cad / .gcd) — the neutral CAD exchange format produced by
 * Allegro, Mentor and CAMCAD. Parsed as a line-oriented keyword stream.
 */

export function isGenCAD(d: Uint8Array): boolean {
  return bytesInclude(d, '$HEADER', 4096) && bytesInclude(d, 'GENCAD', 8192);
}

/** Tokenizes respecting double-quoted strings. */
function tokens(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/** Remainder of the line after the keyword (for names with spaces). */
function rest(line: string): string {
  const s = line.replace(/^\s*\S+\s*/, '').trim();
  return s.startsWith('"') && s.endsWith('"') && s.length > 1 ? s.slice(1, -1) : s;
}

interface ShapePin { name: string; pad: string; x: number; y: number; layer: string }
interface Component {
  name: string;
  x: number;
  y: number;
  layer: string;
  rot: number;
  shape: string;
  mirrorX: boolean;
  mirrorY: boolean;
  flip: boolean;
  device: string;
}
interface Padstack { drilled: boolean; top: boolean; bottom: boolean; pads: string[] }

export function parseGenCAD(data: Uint8Array): RawBoard {
  const lines = splitLines(decodeText(data));
  let toMil = (v: number) => v; // default THOU
  const outlineSegs: Segment[] = [];
  const padRadius = new Map<string, number>();
  const padstacks = new Map<string, Padstack>();
  const shapes = new Map<string, ShapePin[]>();
  const comps: Component[] = [];
  const devices = new Map<string, string[]>();
  const signals = new Map<string, string>(); // "comp\0pin" -> net
  const nails: RawNail[] = [];

  let section = '';
  let curPad = '';
  let curStack: Padstack | null = null;
  let curShape: ShapePin[] | null = null;
  let curComp: Component | null = null;
  let curDevice: string[] | null = null;
  let curSignal = '';
  let curRoute = '';

  const setUnits = (t: string[]) => {
    const u = (t[1] ?? 'THOU').toUpperCase();
    const n = parseFloat(t[2] ?? '1') || 1;
    const table: Record<string, (v: number) => number> = {
      INCH: (v) => v * 1000,
      THOU: (v) => v,
      MIL: (v) => v,
      MM: (v) => v * (1000 / 25.4),
      MM100: (v) => v * (10 / 25.4),
      USER: (v) => (v * 1000) / n,
      USERCM: (v) => (v * 10000) / 25.4 / n,
      USERMM: (v) => (v * 1000) / 25.4 / n,
    };
    toMil = table[u] ?? toMil;
  };
  const num = (s: string | undefined) => toMil(parseFloat(s ?? '0') || 0);

  const geom = (t: string[], sink: (pts: Pt[]) => void) => {
    const k = t[0];
    if (k === 'LINE' && t.length >= 5) {
      sink([{ x: num(t[1]), y: num(t[2]) }, { x: num(t[3]), y: num(t[4]) }]);
    } else if (k === 'ARC' && t.length >= 7) {
      const [x1, y1, x2, y2, cx, cy] = t.slice(1, 7).map((v) => num(v));
      const r = Math.hypot(x1 - cx, y1 - cy);
      const a0 = Math.atan2(y1 - cy, x1 - cx);
      const a1 = Math.atan2(y2 - cy, x2 - cx);
      const pts = arcPoints(cx, cy, r, a0, a1 <= a0 ? a1 + Math.PI * 2 : a1);
      pts[0] = { x: x1, y: y1 };
      pts[pts.length - 1] = { x: x2, y: y2 };
      sink(pts);
    } else if (k === 'CIRCLE' && t.length >= 4) {
      const cx = num(t[1]), cy = num(t[2]), r = num(t[3]);
      sink(arcPoints(cx, cy, r, 0, Math.PI * 2));
    } else if (k === 'RECTANGLE' && t.length >= 5) {
      const x = num(t[1]), y = num(t[2]), w = num(t[3]), h = num(t[4]);
      sink([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('$')) {
      section = line.startsWith('$END') ? '' : line.slice(1).split(/\s/)[0].toUpperCase();
      continue;
    }
    const t = tokens(line);
    const k = t[0]?.toUpperCase();
    switch (section) {
      case 'HEADER':
        if (k === 'UNITS') setUnits(t);
        break;
      case 'BOARD':
        geom(t, (pts) => outlineSegs.push(...pointsToSegments(pts)));
        break;
      case 'PADS':
        if (k === 'PAD') {
          curPad = t[1];
          padRadius.set(curPad, 0);
        } else if (curPad) {
          // Pad "radius" = half of the largest extent of its primitives.
          let r = 0;
          if (k === 'CIRCLE') r = num(t[3]);
          else if (k === 'RECTANGLE') r = Math.max(Math.abs(num(t[3])), Math.abs(num(t[4]))) / 2;
          else if (k === 'LINE') r = Math.max(Math.abs(num(t[1])), Math.abs(num(t[2])), Math.abs(num(t[3])), Math.abs(num(t[4])));
          if (r > (padRadius.get(curPad) ?? 0)) padRadius.set(curPad, r);
        }
        break;
      case 'PADSTACKS':
        if (k === 'PADSTACK') {
          curStack = { drilled: parseFloat(t[2] ?? '0') > 0, top: false, bottom: false, pads: [] };
          padstacks.set(t[1], curStack);
        } else if (k === 'PAD' && curStack) {
          curStack.pads.push(t[1]);
          const layer = (t[2] ?? '').toUpperCase();
          if (layer === 'TOP') curStack.top = true;
          if (layer === 'BOTTOM') curStack.bottom = true;
        }
        break;
      case 'SHAPES':
        if (k === 'SHAPE') {
          curShape = [];
          shapes.set(t[1], curShape);
        } else if (k === 'PIN' && curShape && t.length >= 5) {
          curShape.push({ name: t[1], pad: t[2], x: num(t[3]), y: num(t[4]), layer: (t[5] ?? '').toUpperCase() });
        }
        break;
      case 'COMPONENTS':
        if (k === 'COMPONENT') {
          curComp = { name: t[1], x: 0, y: 0, layer: 'TOP', rot: 0, shape: '', mirrorX: false, mirrorY: false, flip: false, device: '' };
          comps.push(curComp);
        } else if (curComp) {
          if (k === 'PLACE') { curComp.x = num(t[1]); curComp.y = num(t[2]); }
          else if (k === 'LAYER') curComp.layer = (t[1] ?? '').toUpperCase();
          else if (k === 'ROTATION') curComp.rot = parseFloat(t[1]) || 0;
          else if (k === 'DEVICE') curComp.device = rest(line).replace(/ /g, '_');
          else if (k === 'SHAPE') {
            curComp.shape = t[1];
            const flags = t.slice(2).map((s) => s.toUpperCase());
            curComp.mirrorX = flags.includes('MIRRORX');
            curComp.mirrorY = flags.includes('MIRRORY');
            curComp.flip = flags.includes('FLIP');
          }
        }
        break;
      case 'DEVICES':
        if (k === 'DEVICE') {
          curDevice = [];
          devices.set(rest(line).replace(/ /g, '_'), curDevice);
        } else if (curDevice && (k === 'PART' || k === 'VALUE' || k === 'DESC' || k === 'TYPE')) {
          const v = rest(line);
          if (v) curDevice.push(v);
        }
        break;
      case 'SIGNALS':
        if (k === 'SIGNAL') curSignal = rest(line);
        else if (k === 'NODE' && curSignal) signals.set(`${t[1]}\0${t[2]}`, curSignal);
        break;
      case 'ROUTES':
        if (k === 'ROUTE') curRoute = rest(line);
        else if (k === 'VIA' && curRoute && t.length >= 4) {
          nails.push({ x: num(t[2]), y: num(t[3]), side: 'both', net: curRoute });
        }
        break;
    }
  }

  if (!comps.length) throw new Error('GenCAD sin sección $COMPONENTS válida');

  const stackOf = (pad: string) => padstacks.get(pad);
  const radiusOf = (pad: string): number | undefined => {
    const st = stackOf(pad);
    const names = st ? st.pads : [pad];
    let r = 0;
    for (const n of names) r = Math.max(r, padRadius.get(n) ?? 0);
    return r > 0 ? r : undefined;
  };

  const parts: RawPart[] = [];
  const pins: RawPin[] = [];
  const seen = new Set<string>();
  let nc = 0;

  for (const c of comps) {
    const shape = shapes.get(c.shape);
    const key = `${c.layer}|${c.x}|${c.y}|${c.shape}`;
    if (shape && seen.has(key)) continue; // duplicated placement
    seen.add(key);
    const side: Side = c.layer === 'BOTTOM' ? 'bottom' : 'top';
    const desc = [c.device, ...(devices.get(c.device) ?? [])].filter(Boolean);
    const part: RawPart = { name: c.name, side, smd: true, mfg: desc.join(' · ') || c.shape || undefined };
    if (shape) {
      part.smd = !shape.some((p) => stackOf(p.pad)?.drilled);
      let rot = (c.rot * Math.PI) / 180;
      const mx = c.mirrorX ? -1 : 1;
      const my = c.mirrorY ? -1 : 1;
      if (mx * my === -1) rot = Math.PI - rot;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const idx = parts.length + 1;
      for (const sp of shape) {
        const st = stackOf(sp.pad);
        let pside: Side = st ? (st.top && st.bottom ? 'both' : st.top ? 'top' : st.bottom ? 'bottom' : 'both') : side;
        if (!st && (sp.layer === 'TOP' || sp.layer === 'BOTTOM')) pside = sp.layer === 'TOP' ? 'top' : 'bottom';
        if (c.flip) pside = pside === 'top' ? 'bottom' : pside === 'bottom' ? 'top' : pside;
        pins.push({
          part: idx,
          num: sp.name,
          x: c.x + mx * (sp.x * cos - sp.y * sin),
          y: c.y + my * (sp.x * sin + sp.y * cos),
          net: signals.get(`${c.name}\0${sp.name}`) ?? `NC@${nc++}`,
          side: pside,
          radius: radiusOf(sp.pad),
        });
      }
      if (!part.smd) part.side = 'both';
    }
    parts.push(part);
  }

  return {
    format: 'GenCAD',
    outline: outlineSegs.length ? chainSegments(outlineSegs) : [],
    parts,
    pins,
    nails,
  };
}
