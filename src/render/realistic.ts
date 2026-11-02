import type { Board, Part, Pt } from '../core/types';

/**
 * "Real" view: approximates what the board physically looks like — solder
 * mask, ENIG pads, component bodies by material, pin-1 marks, die on BGA
 * substrates. Geometry is derived from pad positions + part classification
 * and baked into Path2D batches per material (same tiling as the diagram view).
 */

export type Material =
  | 'ceramic' | 'tin' | 'resistor' | 'ic' | 'mark' | 'substrate' | 'die' | 'inductor' | 'polymer' | 'band'
  | 'crystal' | 'crystalTop' | 'connector' | 'connectorDark' | 'diode';

export const MATERIALS: Material[] = [
  'ceramic', 'resistor', 'tin', 'diode', 'inductor', 'polymer', 'band', 'ic', 'substrate', 'die', 'crystal', 'crystalTop',
  'connector', 'connectorDark', 'mark',
];

export const MATERIAL_COLOR: Record<Material, string> = {
  ceramic: '#b48858',
  tin: '#c9ced3',
  resistor: '#141414',
  ic: '#17181a',
  mark: '#6c7075',
  substrate: '#3b4b2c',
  die: '#a9afb6',
  inductor: '#3a3e44',
  polymer: '#1a1b1d',
  band: '#9aa4ae',
  crystal: '#c3c8cd',
  crystalTop: '#d9dde1',
  connector: '#e4dcc7',
  connectorDark: '#26282b',
  diode: '#1b1b1c',
};

export const MASK_COLORS = {
  green: { mask: '#0c4a2b', edge: '#082f1c', silk: '#f2f2f2' },
  black: { mask: '#111214', edge: '#060607', silk: '#eeeeee' },
  blue: { mask: '#0e2c5e', edge: '#081a3a', silk: '#f2f2f2' },
  red: { mask: '#6a1414', edge: '#420b0b', silk: '#f2f2f2' },
  purple: { mask: '#3a1c5a', edge: '#241038', silk: '#f2f2f2' },
  white: { mask: '#e6e6e2', edge: '#c8c8c2', silk: '#1a1a1a' },
} as const;
export type MaskColor = keyof typeof MASK_COLORS;

export const PAD_COLOR = '#d4a83e';

export type MaterialPaths = Record<Material, Path2D>;

export const newMaterialPaths = (): MaterialPaths =>
  Object.fromEntries(MATERIALS.map((m) => [m, new Path2D()])) as MaterialPaths;

/** Oriented rectangle from centre, unit axis u, length (along u) and width. */
function orect(path: Path2D, c: Pt, ux: number, uy: number, len: number, wid: number): void {
  const hx = (ux * len) / 2, hy = (uy * len) / 2;
  const vx = (-uy * wid) / 2, vy = (ux * wid) / 2;
  path.moveTo(c.x - hx - vx, c.y - hy - vy);
  path.lineTo(c.x + hx - vx, c.y + hy - vy);
  path.lineTo(c.x + hx + vx, c.y + hy + vy);
  path.lineTo(c.x - hx + vx, c.y - hy + vy);
  path.closePath();
}

function circle(path: Path2D, x: number, y: number, r: number): void {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

/** Appends the physical appearance of one part to the material batches. */
export function bakePart(board: Board, part: Part, P: MaterialPaths): void {
  const info = part.info;
  if (!info || part.dnp || part.virtual || !part.pins.length) return;
  const pins = part.pins.map((id) => board.pins[id]);
  const radii = pins.map((p) => p.r).sort((x, y) => x - y);
  const maxR = radii[Math.floor((radii.length - 1) * 0.75)] ?? 0;
  const { rect } = part;
  const ux = Math.cos(rect.angle), uy = Math.sin(rect.angle);
  const c = { x: rect.cx, y: rect.cy };

  // ---------- two-terminal parts: oriented along the pad axis
  if (pins.length === 2 && /chip-|sod|polymer|molded-ind|crystal/.test(info.body)) {
    const [a, b] = pins;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || maxR * 2;
    const ax = dx / dist, ay = dy / dist;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = dist + maxR * 1.9;
    const wid = Math.max(maxR * 1.9, Math.min(rect.h, rect.w, len * 0.62));
    switch (info.body) {
      case 'chip-cap':
      case 'chip-res':
      case 'chip-ind': {
        orect(info.body === 'chip-cap' ? P.ceramic : P.resistor, mid, ax, ay, len, wid);
        const term = len * 0.22;
        for (const s of [-1, 1]) orect(P.tin, { x: mid.x + (ax * s * (len - term)) / 2, y: mid.y + (ay * s * (len - term)) / 2 }, ax, ay, term, wid * 1.02);
        return;
      }
      case 'sod': {
        orect(P.diode, mid, ax, ay, len * 0.7, wid * 0.9);
        // cathode band on pin 1
        const bw = len * 0.1;
        orect(P.band, { x: mid.x - ax * (len * 0.7 / 2 - bw), y: mid.y - ay * (len * 0.7 / 2 - bw) }, ax, ay, bw, wid * 0.9);
        return;
      }
      case 'polymer': {
        orect(P.polymer, mid, ax, ay, len, wid * 1.15);
        const bw = len * 0.16;
        orect(P.band, { x: mid.x - ax * (len / 2 - bw / 2), y: mid.y - ay * (len / 2 - bw / 2) }, ax, ay, bw, wid * 1.15);
        return;
      }
      case 'molded-ind':
        orect(P.inductor, mid, ax, ay, len * 1.05, Math.max(wid, len * 0.95));
        return;
      case 'crystal':
        orect(P.crystal, mid, ax, ay, len * 1.05, wid * 1.2);
        orect(P.crystalTop, mid, ax, ay, len * 0.8, wid * 0.85);
        return;
    }
  }

  // ---------- multi-pin parts
  const interior = pins.filter((p) => {
    const lx = (p.x - c.x) * ux + (p.y - c.y) * uy;
    const ly = -(p.x - c.x) * uy + (p.y - c.y) * ux;
    return rect.w / 2 - Math.abs(lx) > maxR * 3 && rect.h / 2 - Math.abs(ly) > maxR * 3;
  }).length;
  const isGrid = pins.length >= 16 && interior / pins.length > 0.2;

  switch (info.body) {
    case 'molded-ind':
      orect(P.inductor, c, ux, uy, rect.w * 0.98, rect.h * 0.98);
      return;
    case 'polymer':
      orect(P.polymer, c, ux, uy, rect.w * 0.95, rect.h * 0.95);
      return;
    case 'crystal':
      orect(P.crystal, c, ux, uy, rect.w * 0.95, rect.h * 0.95);
      orect(P.crystalTop, c, ux, uy, rect.w * 0.75, rect.h * 0.7);
      return;
    case 'connector': {
      const light = /FPC|WTOB|BTOB|FFC/i.test(info.description ?? '');
      orect(light ? P.connector : P.connectorDark, c, ux, uy, rect.w * 0.96, rect.h * 0.9);
      return;
    }
  }

  let w: number, h: number;
  if (isGrid || info.body === 'bga') {
    w = rect.w + maxR * 0.4;
    h = rect.h + maxR * 0.4;
  } else if (info.body === 'pdfn' || pins.length <= 6) {
    w = Math.max(rect.w - maxR * 2.2, rect.w * 0.55);
    h = Math.max(rect.h - maxR * 2.2, rect.h * 0.55);
  } else {
    // QFN/QFP: body inside the pad ring
    w = Math.max(rect.w - maxR * 3.2, rect.w * 0.45);
    h = Math.max(rect.h - maxR * 3.2, rect.h * 0.45);
  }

  if (info.kind === 'cpu' || info.kind === 'gpu') {
    orect(P.substrate, c, ux, uy, w, h);
    orect(P.die, c, ux, uy, w * (info.kind === 'gpu' ? 0.42 : 0.5), h * (info.kind === 'gpu' ? 0.42 : 0.36));
  } else {
    orect(P.ic, c, ux, uy, w, h);
  }

  // Pin-1 mark: dot in the body corner nearest to pin 1.
  if (pins.length >= 3) {
    const p1 = pins[0];
    const lx = Math.sign((p1.x - c.x) * ux + (p1.y - c.y) * uy) || -1;
    const ly = Math.sign(-(p1.x - c.x) * uy + (p1.y - c.y) * ux) || 1;
    const r = Math.min(Math.min(w, h) * 0.07, maxR * 1.4);
    const ox = (w / 2 - r * 2.2) * lx, oy = (h / 2 - r * 2.2) * ly;
    circle(P.mark, c.x + ox * ux - oy * uy, c.y + ox * uy + oy * ux, r);
  }
}
