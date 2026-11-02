import { boxOutline, minAreaRect } from './geometry';
import type { Board, Bounds, Nail, Net, NetKind, Part, Pin, Pt, RawBoard } from './types';

/* ------------------------------------------------------------------ */
/* Net classification heuristics (tuned on Apple, Quanta, Compal, Wistron) */
/* ------------------------------------------------------------------ */

const GND_RE = /^(?:[ADPS]?GND|VSS[A-Z0-9_]*|GROUND|GND[_A-Z0-9]*|[A-Z0-9_]*_GND)$/i;
const NC_RE = /^(?:NC|N\/C|NC[_@].*|UNCONNECTED|NOCONNECT|NET_NC|$)$/i;
const POWER_RE = new RegExp(
  [
    '^PP[A-Z0-9_]', // Apple: PP3V3_S5, PPBUS_G3H
    '^\\+?\\d+(?:V|P)\\d*', // +3V3, 5V, 1P8
    '^\\+',
    '^P?\\d+V\\d*[_A-Z]', // P1V05_S0, 3V_S5
    '^(?:VCC|VDD|VIN|VBAT|VBUS|VREF|VREG|VCORE|VGFX|VSA|VCCIO|VCCSA|VPP|VTT|VDDQ|VR_|PVCC|PVDD|AVDD|DVDD|BATT|DCIN|ADAPTER|AC_IN|VSYS|VMAIN)',
    '_(?:\\d+V\\d*|\\d+P\\d+V?)(?:_|$)',
  ].join('|'),
  'i',
);

export function classifyNet(name: string): NetKind {
  const n = name.trim();
  if (NC_RE.test(n)) return 'nc';
  if (GND_RE.test(n)) return 'ground';
  if (POWER_RE.test(n)) return 'power';
  return 'signal';
}

/* ------------------------------------------------------------------ */

function computeBounds(points: Iterable<Pt>): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return { minX, minY, maxX, maxY };
}

/** Squared distance to the nearest other pin in the same part (O(n²) capped). */
function nearestNeighbour(pins: Pin[], idx: number[]): number {
  if (idx.length < 2) return Infinity;
  let best = Infinity;
  const n = Math.min(idx.length, 600);
  for (let i = 0; i < n; i++) {
    const a = pins[idx[i]];
    for (let j = i + 1; j < n; j++) {
      const b = pins[idx[j]];
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d > 0 && d < best) best = d;
    }
  }
  return best;
}

/**
 * Converts any parser output into the normalised board model:
 * indexes nets, sizes pads, derives oriented part outlines and bounds.
 */
export function buildBoard(raw: RawBoard, fileName: string): Board {
  const netIndex = new Map<string, number>();
  const nets: Net[] = [];
  const netId = (name: string) => {
    const key = name.trim() || 'NC';
    let id = netIndex.get(key);
    if (id === undefined) {
      id = nets.length;
      netIndex.set(key, id);
      nets.push({ id, name: key, kind: classifyNet(key), pins: [], nails: [] });
    }
    return id;
  };

  const parts: Part[] = raw.parts.map((p, i) => ({
    id: i,
    name: p.name || `?${i + 1}`,
    side: p.side,
    smd: p.smd,
    mfg: p.mfg,
    pins: [],
    rect: { cx: 0, cy: 0, w: 0, h: 0, angle: 0 },
    virtual: p.name === '...' || p.name.startsWith('TP·'),
  }));

  const pins: Pin[] = [];
  const orphanPins: number[] = [];
  for (const rp of raw.pins) {
    if (!isFinite(rp.x) || !isFinite(rp.y)) continue;
    const partIdx = rp.part >= 1 && rp.part <= parts.length ? rp.part - 1 : -1;
    const id = pins.length;
    const owner = partIdx >= 0 ? parts[partIdx] : null;
    const pin: Pin = {
      id,
      part: partIdx,
      x: rp.x,
      y: rp.y,
      r: rp.radius && rp.radius > 0 ? rp.radius : 0,
      side: rp.side ?? owner?.side ?? 'both',
      net: netId(rp.net),
      num: rp.num ?? '',
      name: rp.name ?? '',
      probe: rp.probe,
    };
    pins.push(pin);
    nets[pin.net].pins.push(id);
    if (owner) owner.pins.push(id);
    else orphanPins.push(id);
  }

  // Orphan pins become a single virtual part so they stay selectable.
  if (orphanPins.length) {
    const vp: Part = {
      id: parts.length, name: '...', side: 'both', smd: true, pins: orphanPins,
      rect: { cx: 0, cy: 0, w: 0, h: 0, angle: 0 }, virtual: true,
    };
    for (const pid of orphanPins) pins[pid].part = vp.id;
    parts.push(vp);
  }

  // Pin numbering + auto pad sizing.
  for (const part of parts) {
    part.pins.forEach((pid, i) => {
      if (!pins[pid].num) pins[pid].num = String(i + 1);
    });
    if (part.virtual) {
      for (const pid of part.pins) if (!pins[pid].r) pins[pid].r = 12;
      continue;
    }
    const nn = Math.sqrt(nearestNeighbour(pins, part.pins));
    const auto = isFinite(nn) ? Math.min(Math.max(nn * 0.36, 3), 40) : 14;
    for (const pid of part.pins) if (!pins[pid].r) pins[pid].r = auto;
  }

  // Oriented outlines.
  for (const part of parts) {
    if (!part.pins.length) continue;
    const pts = part.pins.map((pid) => pins[pid]);
    const maxR = pts.reduce((m, p) => Math.max(m, p.r), 0);
    part.rect = minAreaRect(pts, maxR * 1.6 + 4);
    // Two-pin passives: make the body a little slimmer than the pad row for readability.
    if (part.pins.length === 2) part.rect.h = Math.max(part.rect.h * 0.9, maxR * 2.2);
  }

  const nails: Nail[] = raw.nails
    .filter((n) => isFinite(n.x) && isFinite(n.y))
    .map((n, id) => {
      const net = netId(n.net);
      nets[net].nails.push(id);
      return { id, x: n.x, y: n.y, side: n.side, net, probe: n.probe };
    });

  let outline = raw.outline.filter((o) => o.length >= 2);
  if (!outline.length) outline = boxOutline([...pins, ...nails], 60);

  const bounds = computeBounds(function* () {
    for (const poly of outline) yield* poly;
    yield* pins;
  }());

  return {
    fileName,
    format: raw.format,
    outline,
    parts,
    pins,
    nails,
    nets,
    bounds,
    warnings: raw.warnings ?? [],
  };
}
