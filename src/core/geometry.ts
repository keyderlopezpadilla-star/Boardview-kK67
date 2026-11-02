import type { OrientedRect, Pt } from './types';

export type Segment = [Pt, Pt];

const eq = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const manhattan = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Chains an unordered bag of segments into polylines. Exact endpoint matches
 * are preferred; otherwise the nearest segment is appended when it is closer
 * than closing the current loop.
 */
export function chainSegments(input: Segment[], tolerance = 2): Pt[][] {
  const segs = input.slice();
  const out: Pt[][] = [];
  while (segs.length) {
    const [a, b] = segs.shift()!;
    const poly: Pt[] = [a, b];
    let end = b;
    for (;;) {
      if (eq(end, a) || !segs.length) break;
      let best = -1;
      let bestD = Infinity;
      let flip = false;
      for (let i = 0; i < segs.length; i++) {
        const d1 = manhattan(end, segs[i][0]);
        const d2 = manhattan(end, segs[i][1]);
        if (d1 < bestD) { bestD = d1; best = i; flip = false; }
        if (d2 < bestD) { bestD = d2; best = i; flip = true; }
        if (bestD === 0) break;
      }
      if (bestD > tolerance && manhattan(end, a) <= bestD) {
        poly.push(a);
        break;
      }
      if (bestD > tolerance * 50) break; // disjoint contour: start a new polyline
      const [s0, s1] = segs.splice(best, 1)[0];
      const [n0, n1] = flip ? [s1, s0] : [s0, s1];
      if (!eq(n0, end)) poly.push(n0);
      poly.push(n1);
      end = n1;
    }
    out.push(poly);
  }
  return out;
}

/** Approximates an arc with line segments. Angles in radians, CCW from start to end. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, step = 0.12): Pt[] {
  if (a1 < a0) a1 += Math.PI * 2;
  const n = Math.max(2, Math.ceil((a1 - a0) / step));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

export function pointsToSegments(pts: Pt[]): Segment[] {
  const s: Segment[] = [];
  for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]);
  return s;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 2) return points.slice();
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Minimum-area oriented bounding rectangle (rotating calipers over hull edges).
 * Axis-aligned orientations win ties so most parts stay square to the board.
 */
export function minAreaRect(points: Pt[], pad: number): OrientedRect {
  if (points.length === 0) return { cx: 0, cy: 0, w: 0, h: 0, angle: 0 };
  if (points.length === 1) {
    return { cx: points[0].x, cy: points[0].y, w: pad * 2, h: pad * 2, angle: 0 };
  }
  const hull = convexHull(points);
  const candidates = [0];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    candidates.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (const ang of candidates) {
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * c - p.y * s;
      const v = p.x * s + p.y * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU + pad * 2;
    const h = maxV - minV + pad * 2;
    const area = w * h;
    // 1% bias towards axis-aligned rectangles for visual stability.
    const isAxis = Math.abs(Math.sin(2 * ang)) < 1e-6;
    if (area * (isAxis ? 0.99 : 1) < bestArea) {
      bestArea = area * (isAxis ? 0.99 : 1);
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      // rotate centre back to board space
      const cb = Math.cos(ang);
      const sb = Math.sin(ang);
      best = { cx: cu * cb - cv * sb, cy: cu * sb + cv * cb, w, h, angle: ang };
    }
  }
  return normalizeRect(best!);
}

/** Keep angle in (-π/4, π/4] by swapping width/height, so labels read naturally. */
function normalizeRect(r: OrientedRect): OrientedRect {
  let { angle, w, h } = r;
  while (angle > Math.PI / 4) { angle -= Math.PI / 2; [w, h] = [h, w]; }
  while (angle <= -Math.PI / 4) { angle += Math.PI / 2; [w, h] = [h, w]; }
  return { ...r, angle, w, h };
}

export function rectCorners(r: OrientedRect): Pt[] {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const hw = r.w / 2;
  const hh = r.h / 2;
  return [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([u, v]) => ({ x: r.cx + u * c - v * s, y: r.cy + u * s + v * c }));
}

export function pointInRect(r: OrientedRect, x: number, y: number): boolean {
  const c = Math.cos(-r.angle);
  const s = Math.sin(-r.angle);
  const dx = x - r.cx;
  const dy = y - r.cy;
  const u = dx * c - dy * s;
  const v = dx * s + dy * c;
  return Math.abs(u) <= r.w / 2 && Math.abs(v) <= r.h / 2;
}

/** Outline derived from pin extents when the format has none. */
export function boxOutline(pts: Pt[], margin = 20): Pt[][] {
  if (!pts.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  return [[
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY },
  ]];
}
