import type { Board } from './types';

export type HitKind = 'part' | 'net' | 'pin';

export interface SearchHit {
  kind: HitKind;
  id: number;
  label: string;
  detail: string;
  score: number;
}

/**
 * Scores `text` against `q` (both upper-cased). Exact > prefix > word-prefix >
 * substring > ordered subsequence. Returns 0 when there is no match.
 */
export function fuzzyScore(text: string, q: string): number {
  if (!q) return 0;
  if (text === q) return 1000;
  if (text.startsWith(q)) return 800 - Math.min(text.length - q.length, 200);
  const idx = text.indexOf(q);
  if (idx > 0) {
    const boundary = /[_\-./ ]/.test(text[idx - 1]);
    return (boundary ? 600 : 400) - Math.min(idx, 100) - Math.min(text.length, 100) / 4;
  }
  // subsequence
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return 0;
    gaps += found - ti;
    ti = found + 1;
  }
  return Math.max(1, 200 - gaps * 4 - text.length / 4);
}

/** Pre-computed upper-case keys so typing stays instant on 100k-pin boards. */
export class SearchIndex {
  private partKeys: string[];
  private netKeys: string[];

  constructor(private board: Board) {
    this.partKeys = board.parts.map((p) => p.name.toUpperCase());
    this.netKeys = board.nets.map((n) => n.name.toUpperCase());
  }

  search(query: string, limit = 60, kinds: HitKind[] = ['part', 'net', 'pin']): SearchHit[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    const b = this.board;

    // "U1000.A12" / "U1000 A12" / "U1000-12" → specific pin
    const pinQ = /^([^\s.:-]+)[\s.:-]+(\S+)$/.exec(q);
    if (pinQ && kinds.includes('pin')) {
      const partId = this.partKeys.indexOf(pinQ[1]);
      if (partId >= 0) {
        for (const pid of b.parts[partId].pins) {
          const pin = b.pins[pid];
          const s = fuzzyScore(pin.num.toUpperCase(), pinQ[2]);
          if (s) hits.push({ kind: 'pin', id: pid, label: `${b.parts[partId].name}.${pin.num}`, detail: b.nets[pin.net].name, score: s + 500 });
        }
      }
    }
    if (kinds.includes('part')) {
      this.partKeys.forEach((k, id) => {
        if (b.parts[id].virtual) return;
        const s = fuzzyScore(k, q);
        if (s) hits.push({ kind: 'part', id, label: b.parts[id].name, detail: b.parts[id].mfg ?? `${b.parts[id].pins.length} pines`, score: s + 5 });
      });
    }
    if (kinds.includes('net')) {
      this.netKeys.forEach((k, id) => {
        const s = fuzzyScore(k, q);
        if (s) hits.push({ kind: 'net', id, label: b.nets[id].name, detail: `${b.nets[id].pins.length} pines · ${b.nets[id].kind}`, score: s });
      });
    }
    hits.sort((a, c) => c.score - a.score || a.label.localeCompare(c.label, undefined, { numeric: true }));
    return hits.slice(0, limit);
  }

  partByName(name: string): number {
    return this.partKeys.indexOf(name.toUpperCase());
  }

  netByName(name: string): number {
    return this.netKeys.indexOf(name.toUpperCase());
  }
}
