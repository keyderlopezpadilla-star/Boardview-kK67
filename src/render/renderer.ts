import { rectCorners, pointInRect } from '../core/geometry';
import { isVisible, type Selection, type Settings, type ViewSide } from '../core/store';
import type { Board, Bounds, NetKind, Pt, Side } from '../core/types';
import type { Camera } from './camera';
import { SpatialGrid } from './spatial';

export interface Palette {
  bg: string;
  board: string;
  outline: string;
  partStroke: string;
  partFill: string;
  label: string;
  labelShadow: string;
  pin: Record<NetKind, string>;
  net: string;
  part: string;
  hover: string;
  pinned: string[];
  note: string;
  measure: string;
}

export const PALETTES: Record<Settings['theme'], Palette> = {
  carbon: {
    bg: '#07090c', board: '#0c1411', outline: '#d6a64f', partStroke: 'rgba(150,170,200,0.55)', partFill: 'rgba(120,145,180,0.07)',
    label: '#e8eef6', labelShadow: 'rgba(0,0,0,0.85)',
    pin: { signal: '#d4ac2b', power: '#ff5d63', ground: '#2f6f63', nc: '#3a4766' },
    net: '#22e1ff', part: '#ff6ec7', hover: '#ffffff', pinned: ['#a3e635', '#fb923c', '#c084fc', '#60a5fa', '#facc15'],
    note: '#ff9f1c', measure: '#7cf3a0',
  },
  midnight: {
    bg: '#0b1020', board: '#101935', outline: '#7aa2ff', partStroke: 'rgba(160,180,255,0.5)', partFill: 'rgba(120,140,255,0.08)',
    label: '#eef2ff', labelShadow: 'rgba(5,8,20,0.9)',
    pin: { signal: '#9ad1ff', power: '#ff7aa8', ground: '#36507d', nc: '#2a3355' },
    net: '#ffe066', part: '#7cf3a0', hover: '#ffffff', pinned: ['#ff9f43', '#c084fc', '#22d3ee', '#a3e635', '#f472b6'],
    note: '#ffb347', measure: '#ffe066',
  },
  paper: {
    bg: '#f4f1ea', board: '#e9efe6', outline: '#8a5a00', partStroke: 'rgba(40,50,70,0.65)', partFill: 'rgba(40,60,90,0.05)',
    label: '#111827', labelShadow: 'rgba(255,255,255,0.9)',
    pin: { signal: '#b7791f', power: '#d62839', ground: '#5c7f77', nc: '#8a94ad' },
    net: '#0077ff', part: '#c2185b', hover: '#000000', pinned: ['#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#5d4037'],
    note: '#e65100', measure: '#00897b',
  },
};

type Group = 'T' | 'B' | 'X';
const groupOf = (s: Side): Group => (s === 'top' ? 'T' : s === 'bottom' ? 'B' : 'X');
const KINDS: NetKind[] = ['ground', 'nc', 'signal', 'power'];

interface Layers {
  pins: Record<NetKind, Path2D>;
  /** Square stand-ins used when pads are sub-pixel (much cheaper to rasterise). */
  pinsLod: Record<NetKind, Path2D>;
  partStroke: Path2D;
  pin1: Path2D;
  count: number;
}

/** Spatial tile of baked geometry; only tiles intersecting the viewport are drawn. */
interface Tile {
  bounds: Bounds;
  groups: Record<Group, Layers>;
}

export interface HitResult {
  kind: 'pin' | 'part';
  id: number;
}

export interface Overlay {
  annotatedPins: Set<number>;
  annotationLabel: (pinId: number) => string | null;
  measure: { a: Pt; b: Pt | null } | null;
  hover: HitResult | null;
}

/**
 * Canvas2D board renderer. Static geometry is baked once per board into
 * world-space Path2D batches (per side × net class) so a frame is a handful
 * of fill/stroke calls; dynamic highlights and labels are drawn on top with
 * viewport culling through the spatial grid.
 */
export class BoardRenderer {
  private ctx: CanvasRenderingContext2D;
  private board: Board | null = null;
  private tiles: Tile[] = [];
  private outlinePath: Path2D | null = null;
  private pinGrid: SpatialGrid | null = null;
  private partGrid: SpatialGrid | null = null;
  private medianR = 10;
  private ratsCache = new Map<number, Pt[][]>();
  palette: Palette = PALETTES.carbon;
  dpr = 1;
  /** Set while the camera is animating: skips expensive glow and fine labels. */
  private fast = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
  }

  setBoard(board: Board | null): void {
    this.board = board;
    this.ratsCache.clear();
    if (!board) {
      this.tiles = [];
      return;
    }
    const kinds = () => ({ ground: new Path2D(), nc: new Path2D(), signal: new Path2D(), power: new Path2D() });
    const mk = (): Layers => ({ pins: kinds(), pinsLod: kinds(), partStroke: new Path2D(), pin1: new Path2D(), count: 0 });

    // ~1.5k pads per tile keeps per-tile cost tiny while bounding draw-call count.
    const bb = board.bounds;
    const n = Math.min(32, Math.max(1, Math.ceil(Math.sqrt(board.pins.length / 1500))));
    const tw = (bb.maxX - bb.minX) / n || 1;
    const th = (bb.maxY - bb.minY) / n || 1;
    const tiles: Tile[] = [];
    for (let i = 0; i < n * n; i++) {
      tiles.push({ bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, groups: { T: mk(), B: mk(), X: mk() } });
    }
    const tileAt = (x: number, y: number) => {
      const ix = Math.min(n - 1, Math.max(0, Math.floor((x - bb.minX) / tw)));
      const iy = Math.min(n - 1, Math.max(0, Math.floor((y - bb.minY) / th)));
      return tiles[iy * n + ix];
    };
    const grow = (t: Tile, x0: number, y0: number, x1: number, y1: number) => {
      const b = t.bounds;
      if (x0 < b.minX) b.minX = x0;
      if (y0 < b.minY) b.minY = y0;
      if (x1 > b.maxX) b.maxX = x1;
      if (y1 > b.maxY) b.maxY = y1;
    };

    for (const pin of board.pins) {
      const t = tileAt(pin.x, pin.y);
      const L = t.groups[groupOf(pin.side)];
      const kind = board.nets[pin.net].kind;
      const r = pin.r;
      L.pins[kind].moveTo(pin.x + r, pin.y);
      L.pins[kind].arc(pin.x, pin.y, r, 0, Math.PI * 2);
      L.pinsLod[kind].rect(pin.x - r, pin.y - r, r * 2, r * 2);
      L.count++;
      grow(t, pin.x - r, pin.y - r, pin.x + r, pin.y + r);
    }
    for (const part of board.parts) {
      if (part.virtual || !part.pins.length) continue;
      const t = tileAt(part.rect.cx, part.rect.cy);
      const L = t.groups[groupOf(part.side)];
      const c = rectCorners(part.rect);
      L.partStroke.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) L.partStroke.lineTo(c[i].x, c[i].y);
      L.partStroke.closePath();
      L.count++;
      for (const q of c) grow(t, q.x, q.y, q.x, q.y);
      if (part.pins.length > 2) {
        const p1 = board.pins[part.pins[0]];
        const s = p1.r * 1.5;
        L.pin1.rect(p1.x - s, p1.y - s, s * 2, s * 2);
        grow(t, p1.x - s, p1.y - s, p1.x + s, p1.y + s);
      }
    }
    this.tiles = tiles.filter((t) => isFinite(t.bounds.minX));

    const outline = new Path2D();
    for (const poly of board.outline) {
      outline.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) outline.lineTo(poly[i].x, poly[i].y);
    }
    this.outlinePath = outline;

    // spatial indexes
    const b = board.bounds;
    const area = Math.max((b.maxX - b.minX) * (b.maxY - b.minY), 1);
    const cell = Math.max(10, Math.sqrt(area / Math.max(board.pins.length, 1)) * 3);
    const pad = { minX: b.minX - 2000, minY: b.minY - 2000, maxX: b.maxX + 2000, maxY: b.maxY + 2000 };
    this.pinGrid = new SpatialGrid(pad, cell);
    for (const p of board.pins) this.pinGrid.insert(p.id, p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
    for (const n of board.nails) this.pinGrid.insert(-1 - n.id, n.x - 15, n.y - 15, n.x + 15, n.y + 15);
    this.partGrid = new SpatialGrid(pad, cell * 4);
    for (const part of board.parts) {
      if (part.virtual || !part.pins.length) continue;
      const c = rectCorners(part.rect);
      this.partGrid.insert(part.id, Math.min(...c.map((q) => q.x)), Math.min(...c.map((q) => q.y)), Math.max(...c.map((q) => q.x)), Math.max(...c.map((q) => q.y)));
    }
    const radii = board.pins.map((p) => p.r).sort((x, y) => x - y);
    this.medianR = radii[Math.floor(radii.length / 2)] ?? 10;
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /* ------------------------------------------------------------------ */

  hitTest(cam: Camera, sx: number, sy: number, view: ViewSide): HitResult | null {
    const board = this.board;
    if (!board || !this.pinGrid || !this.partGrid) return null;
    const w = cam.toWorld(sx, sy);
    const tol = 5 / cam.scale;
    let best = -1;
    let bestD = Infinity;
    this.pinGrid.query({ minX: w.x - tol, minY: w.y - tol, maxX: w.x + tol, maxY: w.y + tol }, (id) => {
      if (id < 0) return;
      const p = board.pins[id];
      if (!isVisible(p.side, view)) return;
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d <= Math.max(p.r, tol) && d < bestD) {
        bestD = d;
        best = id;
      }
    });
    if (best >= 0 && board.pins[best].r * cam.scale > 1.5) return { kind: 'pin', id: best };

    let bestPart = -1;
    let bestArea = Infinity;
    this.partGrid.query({ minX: w.x, minY: w.y, maxX: w.x, maxY: w.y }, (id) => {
      const part = board.parts[id];
      if (!isVisible(part.side, view) || !pointInRect(part.rect, w.x, w.y)) return;
      const a = part.rect.w * part.rect.h;
      if (a < bestArea) {
        bestArea = a;
        bestPart = id;
      }
    });
    if (bestPart >= 0) return { kind: 'part', id: bestPart };
    return best >= 0 ? { kind: 'pin', id: best } : null;
  }

  /* ------------------------------------------------------------------ */

  draw(cam: Camera, view: ViewSide, sel: Selection, pinnedNets: number[], settings: Settings, overlay: Overlay, fast = false): void {
    const { ctx, palette: P } = this;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const board = this.board;
    if (!board || !this.tiles.length) return;
    this.fast = fast;

    const m = cam.matrix();
    const world = () => ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    const px = 1 / cam.scale; // one CSS pixel in world units

    // Highlight sets
    const selNet = sel?.kind === 'net' ? sel.id : sel?.kind === 'pin' ? board.pins[sel.id].net : -1;
    const selPart = sel?.kind === 'part' ? sel.id : sel?.kind === 'pin' ? board.pins[sel.id].part : -1;
    const focus = selNet >= 0 || selPart >= 0 || pinnedNets.length > 0;

    world();
    // Board substrate
    if (this.outlinePath) {
      ctx.fillStyle = P.board;
      ctx.fill(this.outlinePath, 'evenodd');
      ctx.lineWidth = 1.6 * px;
      ctx.strokeStyle = P.outline;
      ctx.lineJoin = 'round';
      ctx.stroke(this.outlinePath);
    }

    const groups: { g: Group; alpha: number }[] =
      view === 'top' ? [{ g: 'T', alpha: 1 }, { g: 'X', alpha: 1 }]
        : view === 'bottom' ? [{ g: 'B', alpha: 1 }, { g: 'X', alpha: 1 }]
          : [{ g: 'B', alpha: 0.38 }, { g: 'T', alpha: 1 }, { g: 'X', alpha: 1 }];

    const pinsVisible = this.medianR * cam.scale > 0.35;
    const lod = this.medianR * cam.scale < 1.6;
    const dim = focus ? 0.3 : 1;
    const vis = cam.visibleWorld(8);
    const visibleTiles = this.tiles.filter((t) =>
      t.bounds.maxX >= vis.minX && t.bounds.minX <= vis.maxX && t.bounds.maxY >= vis.minY && t.bounds.minY <= vis.maxY);

    for (const { g, alpha } of groups) {
      // part bodies
      ctx.globalAlpha = alpha * dim;
      ctx.fillStyle = P.partFill;
      ctx.lineWidth = 0.8 * px;
      ctx.strokeStyle = P.partStroke;
      for (const t of visibleTiles) {
        const L = t.groups[g];
        if (!L.count) continue;
        ctx.fill(L.partStroke);
        ctx.stroke(L.partStroke);
      }
      if (!pinsVisible) continue;
      for (const k of KINDS) {
        ctx.globalAlpha = alpha * dim * (k === 'ground' && settings.dimGround ? 0.7 : 1);
        ctx.fillStyle = P.pin[k];
        for (const t of visibleTiles) {
          const L = t.groups[g];
          if (L.count) ctx.fill(lod ? L.pinsLod[k] : L.pins[k]);
        }
      }
      if (this.medianR * cam.scale > 3) {
        ctx.globalAlpha = alpha * dim * 0.9;
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = P.label;
        for (const t of visibleTiles) if (t.groups[g].count) ctx.stroke(t.groups[g].pin1);
      }
    }
    ctx.globalAlpha = 1;

    // Nails / test points
    if (board.nails.length && cam.scale * 12 > 1.2) {
      ctx.globalAlpha = dim * 0.9;
      ctx.lineWidth = 1.2 * px;
      ctx.strokeStyle = P.outline;
      ctx.beginPath();
      const r = 10;
      for (const n of board.nails) {
        if (!isVisible(n.side, view)) continue;
        ctx.moveTo(n.x - r, n.y);
        ctx.lineTo(n.x, n.y + r);
        ctx.lineTo(n.x + r, n.y);
        ctx.lineTo(n.x, n.y - r);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Pinned nets (multi-net compare)
    pinnedNets.forEach((nid, i) => this.drawNet(nid, P.pinned[i % P.pinned.length], view, settings, px));
    // Selected part
    if (selPart >= 0) this.drawPart(selPart, P.part, view, px, cam);
    // Selected net
    if (selNet >= 0) this.drawNet(selNet, P.net, view, settings, px);
    // Selected pin ring
    if (sel?.kind === 'pin') {
      const p = board.pins[sel.id];
      ctx.lineWidth = 2.5 * px;
      ctx.strokeStyle = P.hover;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(p.r * 1.5, 6 * px), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Annotation markers
    if (overlay.annotatedPins.size) {
      ctx.fillStyle = P.note;
      ctx.beginPath();
      for (const id of overlay.annotatedPins) {
        const p = board.pins[id];
        if (!p || !isVisible(p.side, view)) continue;
        const r = Math.max(p.r * 0.45, 2.2 * px);
        ctx.moveTo(p.x + p.r * 0.7 + r, p.y + p.r * 0.7);
        ctx.arc(p.x + p.r * 0.7, p.y + p.r * 0.7, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Hover
    if (overlay.hover) {
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = P.hover;
      if (overlay.hover.kind === 'pin') {
        const p = board.pins[overlay.hover.id];
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r * 1.25, 4 * px), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const c = rectCorners(board.parts[overlay.hover.id].rect);
        ctx.beginPath();
        ctx.moveTo(c[0].x, c[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // ---------------- Screen-space labels (always readable, never mirrored)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(cam, view, settings, selNet, overlay);

    if (overlay.measure) this.drawMeasure(cam, overlay.measure, settings);
  }

  private drawPart(id: number, color: string, view: ViewSide, px: number, cam: Camera): void {
    const { ctx } = this;
    const board = this.board!;
    const part = board.parts[id];
    const c = rectCorners(part.rect);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = this.fast ? 0 : 14;
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '22';
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Owner pins at full intensity, keeping their net-class colours.
    const byKind: Record<NetKind, Path2D> = { ground: new Path2D(), nc: new Path2D(), signal: new Path2D(), power: new Path2D() };
    const minR = 1.5 / cam.scale;
    for (const pid of part.pins) {
      const p = board.pins[pid];
      if (!isVisible(p.side, view)) continue;
      const r = Math.max(p.r, minR);
      const path = byKind[board.nets[p.net].kind];
      path.moveTo(p.x + r, p.y);
      path.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    for (const k of KINDS) {
      ctx.fillStyle = this.palette.pin[k];
      ctx.fill(byKind[k]);
    }
  }

  private drawNet(nid: number, color: string, view: ViewSide, settings: Settings, px: number): void {
    const { ctx } = this;
    const board = this.board!;
    const net = board.nets[nid];
    if (!net) return;
    const minR = 2.5 * px;

    if (settings.showRatsnest && net.kind !== 'ground' && net.pins.length + net.nails.length <= 1200) {
      const segs = this.ratsnest(nid);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = color;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath();
      for (const [a, b] of segs) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = !this.fast && net.pins.length < 400 ? 10 : 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const pid of net.pins) {
      const p = board.pins[pid];
      if (!isVisible(p.side, view)) continue;
      const r = Math.max(p.r, minR);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    for (const nid2 of net.nails) {
      const n = board.nails[nid2];
      if (!isVisible(n.side, view)) continue;
      const r = Math.max(12, minR);
      ctx.moveTo(n.x - r, n.y);
      ctx.lineTo(n.x, n.y + r);
      ctx.lineTo(n.x + r, n.y);
      ctx.lineTo(n.x, n.y - r);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /** Prim MST over net pins — readable "airwires" instead of a star. */
  private ratsnest(nid: number): Pt[][] {
    const cached = this.ratsCache.get(nid);
    if (cached) return cached;
    const board = this.board!;
    const net = board.nets[nid];
    const pts: Pt[] = [...net.pins.map((i) => board.pins[i]), ...net.nails.map((i) => board.nails[i])];
    const n = pts.length;
    const segs: Pt[][] = [];
    if (n > 1) {
      const inTree = new Uint8Array(n);
      const dist = new Float64Array(n).fill(Infinity);
      const from = new Int32Array(n).fill(-1);
      dist[0] = 0;
      for (let k = 0; k < n; k++) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < n; i++) if (!inTree[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0) break;
        inTree[u] = 1;
        if (from[u] >= 0) segs.push([pts[from[u]], pts[u]]);
        for (let i = 0; i < n; i++) {
          if (inTree[i]) continue;
          const d = (pts[i].x - pts[u].x) ** 2 + (pts[i].y - pts[u].y) ** 2;
          if (d < dist[i]) { dist[i] = d; from[i] = u; }
        }
      }
    }
    this.ratsCache.set(nid, segs);
    return segs;
  }

  private drawLabels(cam: Camera, view: ViewSide, settings: Settings, selNet: number, overlay: Overlay): void {
    const { ctx, palette: P } = this;
    const board = this.board!;
    const vis = cam.visibleWorld(40);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const font = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

    // Part designators
    let budget = this.fast ? 250 : 1200;
    this.partGrid?.query(vis, (id) => {
      if (budget <= 0) return;
      const part = board.parts[id];
      if (!isVisible(part.side, view)) return;
      const minDim = Math.min(part.rect.w, part.rect.h) * cam.scale;
      const maxDim = Math.max(part.rect.w, part.rect.h) * cam.scale;
      if (minDim < 9 || maxDim < part.name.length * 5) return;
      const size = Math.min(Math.max(minDim * 0.32, 9), 26);
      const s = cam.toScreen(part.rect.cx, part.rect.cy);
      ctx.font = `600 ${size}px ${font}`;
      // Once pad numbers are readable the designator steps back so it doesn't fight them.
      ctx.globalAlpha = this.medianR * cam.scale > 7 ? 0.5 : 0.92;
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.labelShadow;
      ctx.strokeText(part.name, s.x, s.y);
      ctx.fillStyle = P.label;
      ctx.fillText(part.name, s.x, s.y);
      budget--;
    });
    ctx.globalAlpha = 1;

    // Pin numbers / net names
    if (settings.showPinLabels && this.medianR * cam.scale > 6.5 && this.pinGrid) {
      let pinBudget = this.fast ? 400 : 2500;
      this.pinGrid.query(vis, (id) => {
        if (id < 0 || pinBudget <= 0) return;
        const p = board.pins[id];
        if (!isVisible(p.side, view)) return;
        const rpx = p.r * cam.scale;
        if (rpx < 6.5) return;
        const s = cam.toScreen(p.x, p.y);
        const size = Math.min(Math.max(rpx * 0.62, 7), 15);
        ctx.font = `600 ${size}px ${font}`;
        const kind = board.nets[p.net].kind;
        ctx.fillStyle = p.net === selNet ? '#00131a' : kind === 'ground' || kind === 'nc' ? P.label : '#0a0a0a';
        if (rpx > 9 || p.num.length <= 3) ctx.fillText(p.num, s.x, settings.showNetLabels && rpx > 15 ? s.y - size * 0.45 : s.y);
        if (settings.showNetLabels && rpx > 15) {
          const net = board.nets[p.net].name;
          const ns = Math.min(Math.max(rpx * 0.3, 6), 11);
          ctx.font = `500 ${ns}px ${font}`;
          const maxChars = Math.max(3, Math.floor((rpx * 2) / (ns * 0.62)));
          ctx.fillText(net.length > maxChars ? net.slice(0, maxChars - 1) + '…' : net, s.x, s.y + size * 0.55);
        }
        pinBudget--;
      });
    }

    // Annotation values (bench readings)
    if (overlay.annotatedPins.size && this.medianR * cam.scale > 3) {
      ctx.font = `600 11px ${font}`;
      ctx.textAlign = 'left';
      for (const id of overlay.annotatedPins) {
        const p = board.pins[id];
        if (!p || !isVisible(p.side, view)) continue;
        const txt = overlay.annotationLabel(id);
        if (!txt) continue;
        const s = cam.toScreen(p.x, p.y);
        if (s.x < -50 || s.y < -50 || s.x > cam.width + 50 || s.y > cam.height + 50) continue;
        const x = s.x + p.r * cam.scale + 6;
        const w = ctx.measureText(txt).width + 8;
        ctx.fillStyle = P.note;
        ctx.globalAlpha = 0.92;
        roundRect(ctx, x, s.y - 8, w, 16, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a0d00';
        ctx.fillText(txt, x + 4, s.y + 0.5);
      }
      ctx.textAlign = 'center';
    }
  }

  private drawMeasure(cam: Camera, m: { a: Pt; b: Pt | null }, settings: Settings): void {
    const { ctx, palette: P } = this;
    const a = cam.toScreen(m.a.x, m.a.y);
    ctx.strokeStyle = P.measure;
    ctx.fillStyle = P.measure;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (!m.b) return;
    const b = cam.toScreen(m.b.x, m.b.y);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
    const d = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    const txt = settings.units === 'mm' ? `${(d * 0.0254).toFixed(3)} mm` : `${d.toFixed(1)} mil`;
    const dx = Math.abs(m.b.x - m.a.x), dy = Math.abs(m.b.y - m.a.y);
    const sub = settings.units === 'mm' ? `Δx ${(dx * 0.0254).toFixed(2)}  Δy ${(dy * 0.0254).toFixed(2)}` : `Δx ${dx.toFixed(0)}  Δy ${dy.toFixed(0)}`;
    ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
    const w = Math.max(ctx.measureText(txt).width, ctx.measureText(sub).width) + 14;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    roundRect(ctx, mx - w / 2, my - 34, w, 34, 6);
    ctx.fill();
    ctx.fillStyle = P.measure;
    ctx.textAlign = 'center';
    ctx.fillText(txt, mx, my - 23);
    ctx.globalAlpha = 0.75;
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(sub, mx, my - 9);
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
