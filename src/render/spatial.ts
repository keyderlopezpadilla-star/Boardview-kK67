import type { Bounds } from '../core/types';

/**
 * Uniform grid over item bounding boxes. Constant-time-ish hit testing and
 * viewport culling for boards with 100k+ pads.
 */
export class SpatialGrid {
  private cells = new Map<number, number[]>();
  private readonly inv: number;
  private readonly cols: number;

  constructor(private readonly bounds: Bounds, cellSize: number) {
    this.inv = 1 / Math.max(cellSize, 1);
    this.cols = Math.ceil((bounds.maxX - bounds.minX) * this.inv) + 2;
  }

  private key(ix: number, iy: number) {
    return iy * this.cols + ix;
  }

  private ix(x: number) {
    return Math.floor((x - this.bounds.minX) * this.inv);
  }

  private iy(y: number) {
    return Math.floor((y - this.bounds.minY) * this.inv);
  }

  insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const x0 = this.ix(minX), x1 = this.ix(maxX), y0 = this.iy(minY), y1 = this.iy(maxY);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = this.key(x, y);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(id);
      }
  }

  /** Visits unique ids whose cells intersect the box. */
  query(b: Bounds, visit: (id: number) => void): void {
    const x0 = this.ix(b.minX), x1 = this.ix(b.maxX), y0 = this.iy(b.minY), y1 = this.iy(b.maxY);
    const cellCount = (x1 - x0 + 1) * (y1 - y0 + 1);
    const seen = cellCount > 1 ? new Set<number>() : null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const c = this.cells.get(this.key(x, y));
        if (!c) continue;
        for (const id of c) {
          if (seen) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          visit(id);
        }
      }
  }
}
