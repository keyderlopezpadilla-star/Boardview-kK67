import type { Board } from '../core/types';
import { rectCorners } from '../core/geometry';
import { Camera } from './camera';
import type { Palette } from './renderer';

/** Overview map with the live viewport frustum; click or drag to navigate. */
export class Minimap {
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  private mini = new Camera();
  private ctx: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement, private onNavigate: (x: number, y: number) => void) {
    this.ctx = canvas.getContext('2d')!;
    let dragging = false;
    const nav = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const w = this.mini.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.onNavigate(w.x, w.y);
    };
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      nav(e);
      e.stopPropagation();
    });
    canvas.addEventListener('pointermove', (e) => dragging && nav(e));
    canvas.addEventListener('pointerup', () => (dragging = false));
  }

  draw(board: Board | null, cam: Camera, palette: Palette, side: string): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!board || !w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const key = `${board.fileName}|${cam.rotation}|${cam.mirror}|${w}x${h}|${palette.bg}|${side}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.mini.width = w;
      this.mini.height = h;
      this.mini.rotation = cam.rotation;
      this.mini.mirror = cam.mirror;
      this.mini.fit(board.bounds, 8, true);
      this.cache = this.renderCache(board, palette, dpr, side);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.cache) ctx.drawImage(this.cache, 0, 0);

    // viewport frustum
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const corners = [
      cam.toWorld(0, 0), cam.toWorld(cam.width, 0), cam.toWorld(cam.width, cam.height), cam.toWorld(0, cam.height),
    ].map((p) => this.mini.toScreen(p.x, p.y));
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,225,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = palette.net;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  private renderCache(board: Board, P: Palette, dpr: number, side: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d')!;
    const m = this.mini.matrix();
    ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    const px = 1 / this.mini.scale;
    ctx.beginPath();
    for (const poly of board.outline) poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.fillStyle = P.board;
    ctx.fill('evenodd');
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = px;
    ctx.stroke();
    ctx.beginPath();
    for (const part of board.parts) {
      if (part.virtual || (side !== 'both' && part.side !== 'both' && part.side !== side)) continue;
      const q = rectCorners(part.rect);
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.closePath();
    }
    ctx.fillStyle = P.partStroke;
    ctx.fill();
    return c;
  }
}
