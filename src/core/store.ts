import type { Board, Side } from './types';

export type ViewSide = 'top' | 'bottom' | 'both';

export type Selection =
  | { kind: 'part'; id: number }
  | { kind: 'pin'; id: number }
  | { kind: 'net'; id: number }
  | null;

export interface Settings {
  units: 'mil' | 'mm';
  showRatsnest: boolean;
  dimGround: boolean;
  showPinLabels: boolean;
  showNetLabels: boolean;
  autoPdfSearch: boolean;
  fzKey: string;
  xzzKey: string;
  theme: 'carbon' | 'midnight' | 'paper';
  /** Diagram (net-coloured pads) or physical appearance. */
  view: 'diagram' | 'real';
  maskColor: 'green' | 'black' | 'blue' | 'red' | 'purple' | 'white';
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'mil',
  showRatsnest: true,
  dimGround: true,
  showPinLabels: true,
  showNetLabels: true,
  autoPdfSearch: true,
  fzKey: '',
  xzzKey: '',
  theme: 'carbon',
  view: 'diagram',
  maskColor: 'green',
};

export interface State {
  board: Board | null;
  side: ViewSide;
  selection: Selection;
  /** Extra nets pinned for multi-net comparison (shift+click). */
  pinnedNets: number[];
  hover: { kind: 'part' | 'pin'; id: number } | null;
  settings: Settings;
  measuring: boolean;
}

type Listener = (s: State, changed: Set<keyof State>) => void;

/** Minimal observable store; listeners receive the set of changed keys. */
export class Store {
  private listeners = new Set<Listener>();
  private pending = new Set<keyof State>();
  private scheduled = false;

  constructor(public state: State) {}

  set(patch: Partial<State>): void {
    for (const k of Object.keys(patch) as (keyof State)[]) {
      if (this.state[k] !== patch[k]) this.pending.add(k);
    }
    Object.assign(this.state, patch);
    if (!this.scheduled && this.pending.size) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const changed = this.pending;
        this.pending = new Set();
        for (const l of this.listeners) l(this.state, changed);
      });
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

const SETTINGS_KEY = 'kk67.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export const isVisible = (itemSide: Side, view: ViewSide) => view === 'both' || itemSide === 'both' || itemSide === view;
