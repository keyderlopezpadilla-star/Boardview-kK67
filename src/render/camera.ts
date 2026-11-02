import type { Bounds, Pt } from '../core/types';

export interface Affine {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

/**
 * World (mil, Y-up) → screen (CSS px) camera with quarter-turn rotation,
 * horizontal mirroring (bottom-side view) and critically-damped smoothing.
 * Zoom is anchored: the world point under the cursor stays pinned during the
 * whole animation, not only at its end.
 */
export class Camera {
  width = 1;
  height = 1;
  cx = 0;
  cy = 0;
  scale = 0.1;
  rotation = 0; // quarter turns, 0..3
  mirror = false;

  private tcx = 0;
  private tcy = 0;
  private tLogScale = Math.log(0.1);
  private anchor: { world: Pt; screen: Pt } | null = null;
  minScale = 1e-4;
  maxScale = 40;

  /** Linear part for scale = 1. */
  private basis() {
    const ang = (this.rotation * Math.PI) / 2;
    const cos = Math.round(Math.cos(ang));
    const sin = Math.round(Math.sin(ang));
    const m = this.mirror ? -1 : 1;
    return { a: m * cos, b: m * sin, c: sin, d: -cos };
  }

  matrix(): Affine {
    const k = this.basis();
    const s = this.scale;
    const a = k.a * s, b = k.b * s, c = k.c * s, d = k.d * s;
    return { a, b, c, d, e: this.width / 2 - (a * this.cx + c * this.cy), f: this.height / 2 - (b * this.cx + d * this.cy) };
  }

  toScreen(x: number, y: number): Pt {
    const m = this.matrix();
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  toWorld(sx: number, sy: number, scale = this.scale, cx = this.cx, cy = this.cy): Pt {
    const k = this.basis();
    const dx = (sx - this.width / 2) / scale;
    const dy = (sy - this.height / 2) / scale;
    // basis is orthonormal (±1 entries) → inverse is its transpose
    return { x: cx + k.a * dx + k.b * dy, y: cy + k.c * dx + k.d * dy };
  }

  /** World-space axis-aligned rectangle currently visible (+margin in px). */
  visibleWorld(marginPx = 0): Bounds {
    const pts = [
      this.toWorld(-marginPx, -marginPx), this.toWorld(this.width + marginPx, -marginPx),
      this.toWorld(-marginPx, this.height + marginPx), this.toWorld(this.width + marginPx, this.height + marginPx),
    ];
    return {
      minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
    };
  }

  /* ---------------- animated controls ---------------- */

  zoomAt(sx: number, sy: number, factor: number): void {
    const world = this.anchor && this.anchor.screen.x === sx && this.anchor.screen.y === sy
      ? this.anchor.world
      : this.toWorld(sx, sy);
    this.anchor = { world, screen: { x: sx, y: sy } };
    this.tLogScale = clampLog(this.tLogScale + Math.log(factor), this.minScale, this.maxScale);
  }

  panBy(dxPx: number, dyPx: number, immediate = true): void {
    this.anchor = null;
    const k = this.basis();
    const dx = -dxPx / this.scale;
    const dy = -dyPx / this.scale;
    const wx = k.a * dx + k.b * dy;
    const wy = k.c * dx + k.d * dy;
    this.tcx += wx;
    this.tcy += wy;
    if (immediate) {
      this.cx += wx;
      this.cy += wy;
    }
  }

  flyTo(x: number, y: number, scale?: number): void {
    this.anchor = null;
    this.tcx = x;
    this.tcy = y;
    if (scale) this.tLogScale = clampLog(Math.log(scale), this.minScale, this.maxScale);
  }

  /** Fit a world box (taking current rotation into account). */
  fit(b: Bounds, paddingPx = 40, immediate = false): void {
    const swap = this.rotation % 2 === 1;
    const w = (swap ? b.maxY - b.minY : b.maxX - b.minX) || 1;
    const h = (swap ? b.maxX - b.minX : b.maxY - b.minY) || 1;
    if (this.width <= paddingPx * 2 || this.height <= paddingPx * 2) paddingPx = 0;
    const s = Math.min(this.width / w, this.height / h, (this.width - paddingPx * 2) / w, (this.height - paddingPx * 2) / h);
    if (!(s > 0) || !isFinite(s)) return;
    this.minScale = Math.min(s * 0.25, this.minScale);
    this.flyTo((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, Math.max(s, 1e-5));
    if (immediate) this.snap();
  }

  snap(): void {
    this.cx = this.tcx;
    this.cy = this.tcy;
    this.scale = Math.exp(this.tLogScale);
    this.anchor = null;
  }

  /** Advances the animation; returns true while still moving. */
  step(dtMs: number): boolean {
    const t = 1 - Math.exp(-dtMs / 55); // ~55ms time constant: snappy yet fluid
    const curLog = Math.log(this.scale);
    const nextLog = Math.abs(this.tLogScale - curLog) < 1e-4 ? this.tLogScale : curLog + (this.tLogScale - curLog) * t;
    this.scale = Math.exp(nextLog);

    if (this.anchor) {
      // keep anchor fixed: centre is a function of scale
      const { world, screen } = this.anchor;
      const k = this.basis();
      const dx = (screen.x - this.width / 2) / this.scale;
      const dy = (screen.y - this.height / 2) / this.scale;
      this.cx = world.x - (k.a * dx + k.b * dy);
      this.cy = world.y - (k.c * dx + k.d * dy);
      this.tcx = this.cx;
      this.tcy = this.cy;
      if (nextLog === this.tLogScale) this.anchor = null;
    } else {
      const ex = this.tcx - this.cx;
      const ey = this.tcy - this.cy;
      if (Math.abs(ex * this.scale) < 0.05 && Math.abs(ey * this.scale) < 0.05) {
        this.cx = this.tcx;
        this.cy = this.tcy;
      } else {
        this.cx += ex * t;
        this.cy += ey * t;
      }
    }
    return this.scale !== Math.exp(this.tLogScale) || this.cx !== this.tcx || this.cy !== this.tcy || !!this.anchor;
  }

  get targetScale(): number {
    return Math.exp(this.tLogScale);
  }
}

function clampLog(v: number, min: number, max: number): number {
  return Math.min(Math.log(max), Math.max(Math.log(min), v));
}
