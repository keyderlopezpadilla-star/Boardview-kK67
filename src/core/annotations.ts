import type { Board } from './types';

/**
 * Bench measurements & notes attached to pins, parts or nets. Persisted per
 * board fingerprint in localStorage; exportable as JSON to share with a team.
 */

export type TargetKind = 'pin' | 'part' | 'net';

export interface Annotation {
  /** Stable key: "part:U1000", "pin:U1000.A12", "net:PP3V3_S5". */
  key: string;
  note: string;
  diode?: string;
  voltage?: string;
  resistance?: string;
  updated: number;
}

export function boardFingerprint(b: Board): string {
  // Cheap, stable across reloads of the same file, distinct between boards.
  let h = 2166136261;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  feed(`${b.format}|${b.parts.length}|${b.pins.length}|${b.nets.length}`);
  for (let i = 0; i < b.parts.length; i += Math.max(1, Math.floor(b.parts.length / 64))) feed(b.parts[i].name);
  return (h >>> 0).toString(36);
}

export function annotationKey(b: Board, kind: TargetKind, id: number): string {
  if (kind === 'part') return `part:${b.parts[id].name}`;
  if (kind === 'net') return `net:${b.nets[id].name}`;
  const pin = b.pins[id];
  return `pin:${b.parts[pin.part]?.name ?? '?'}.${pin.num}`;
}

export class AnnotationStore {
  private map = new Map<string, Annotation>();
  private storageKey = '';
  private listeners = new Set<() => void>();

  load(board: Board): void {
    this.storageKey = `kk67.notes.${boardFingerprint(board)}`;
    this.map.clear();
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) for (const a of JSON.parse(raw) as Annotation[]) this.map.set(a.key, a);
    } catch {
      /* ignore corrupt or unavailable storage */
    }
    this.emit();
  }

  get(key: string): Annotation | undefined {
    return this.map.get(key);
  }

  all(): Annotation[] {
    return [...this.map.values()].sort((a, b) => b.updated - a.updated);
  }

  upsert(a: Omit<Annotation, 'updated'>): void {
    const empty = !a.note.trim() && !a.diode?.trim() && !a.voltage?.trim() && !a.resistance?.trim();
    if (empty) this.map.delete(a.key);
    else this.map.set(a.key, { ...a, updated: Date.now() });
    this.persist();
  }

  remove(key: string): void {
    this.map.delete(key);
    this.persist();
  }

  importJSON(json: string): number {
    const list = JSON.parse(json) as Annotation[];
    if (!Array.isArray(list)) throw new Error('Formato de notas inválido');
    let n = 0;
    for (const a of list) {
      if (typeof a?.key === 'string') {
        this.map.set(a.key, { ...a, updated: a.updated ?? Date.now() });
        n++;
      }
    }
    this.persist();
    return n;
  }

  exportJSON(): string {
    return JSON.stringify(this.all(), null, 2);
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.all()));
    } catch {
      /* quota / private mode: keep in memory */
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
