import { annotationKey, type AnnotationStore, type TargetKind } from '../core/annotations';
import type { Selection, Settings } from '../core/store';
import type { Board, NetKind } from '../core/types';
import { h, icon } from './dom';
import { VirtualList } from './virtualList';

const KIND_TEXT: Record<NetKind, string> = { power: 'Alimentación', ground: 'Masa', signal: 'Señal', nc: 'Sin conexión' };
const SIDE_TEXT = { top: 'Superior', bottom: 'Inferior', both: 'Ambas (TH)' } as const;
const collator = new Intl.Collator(undefined, { numeric: true });

export interface InspectorActions {
  select: (sel: Exclude<Selection, null>, additive?: boolean) => void;
  focus: (sel: Exclude<Selection, null>) => void;
  searchPdf: (text: string) => void;
  togglePinnedNet: (net: number) => void;
  isPinned: (net: number) => boolean;
  pdfAvailable: () => boolean;
}

type PinRow = { pin: number; a: string; b: string; kind: NetKind; noted: boolean };

/** Right-hand panel: contextual details, pin tables and bench annotations. */
export class Inspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private board: Board | null = null;
  private sel: Selection = null;
  private list: VirtualList<PinRow>;

  constructor(private notes: AnnotationStore, private actions: InspectorActions, private settings: () => Settings) {
    this.body = h('div.inspector-body');
    this.el = h('aside.inspector', {}, this.body);
    this.list = new VirtualList<PinRow>(
      28,
      (r) => h('div.pin-row' + (r.noted ? '.noted' : ''), {}, h('span.pin-a', {}, r.a), h(`span.dot.${r.kind}`), h('span.pin-b', {}, r.b)),
      (r) => String(r.pin),
      (r, ev) => this.actions.select({ kind: 'pin', id: r.pin }, ev.shiftKey),
    );
    // Don't rebuild while the user is typing in the note editor (would steal focus).
    this.notes.onChange(() => !this.el.contains(document.activeElement) && this.render());
    this.render();
  }

  setBoard(b: Board | null): void {
    this.board = b;
    this.sel = null;
    this.render();
  }

  setSelection(sel: Selection): void {
    this.sel = sel;
    this.render();
  }

  private fmt(v: number): string {
    return this.settings().units === 'mm' ? `${(v * 0.0254).toFixed(2)} mm` : `${Math.round(v)} mil`;
  }

  render(): void {
    const b = this.board;
    const sel = this.sel;
    if (!b) {
      this.body.replaceChildren(h('div.empty-state', {}, icon('layers'), h('p', {}, 'Abre un boardview para inspeccionar componentes, redes y pines.')));
      return;
    }
    if (!sel) {
      this.body.replaceChildren(this.boardSummary(b));
      return;
    }
    if (sel.kind === 'part') this.body.replaceChildren(...this.partView(b, sel.id));
    else if (sel.kind === 'net') this.body.replaceChildren(...this.netView(b, sel.id));
    else this.body.replaceChildren(...this.pinView(b, sel.id));
  }

  private boardSummary(b: Board): HTMLElement {
    const counts: Record<NetKind, number> = { power: 0, ground: 0, signal: 0, nc: 0 };
    for (const n of b.nets) counts[n.kind]++;
    const w = b.bounds.maxX - b.bounds.minX;
    const hgt = b.bounds.maxY - b.bounds.minY;
    const real = b.parts.filter((p) => !p.virtual);
    const top = real.filter((p) => p.side === 'top').length;
    const bottom = real.filter((p) => p.side === 'bottom').length;
    const stat = (label: string, value: string | number) => h('div.stat', {}, h('span', {}, label), h('b', {}, String(value)));
    return h('div.panel', {},
      h('div.eyebrow', {}, 'Placa'),
      h('h2.title', { title: b.fileName }, b.fileName),
      h('div.badges', {}, h('span.badge', {}, b.format), h('span.badge', {}, `${this.fmt(w)} × ${this.fmt(hgt)}`)),
      h('div.stats', {},
        stat('Componentes', real.length.toLocaleString()), stat('Pines', b.pins.length.toLocaleString()),
        stat('Redes', b.nets.length.toLocaleString()), stat('Test points', b.nails.length.toLocaleString()),
        stat('Cara superior', top.toLocaleString()), stat('Cara inferior', bottom.toLocaleString()),
      ),
      h('div.eyebrow', {}, 'Redes por tipo'),
      h('div.kind-bars', {}, ...(Object.keys(counts) as NetKind[]).map((k) =>
        h('div.kind-bar', {}, h(`span.dot.${k}`), h('span', {}, KIND_TEXT[k]), h('b', {}, counts[k].toLocaleString())),
      )),
      b.warnings.length ? h('div.warn', {}, ...b.warnings.map((w2) => h('p', {}, w2))) : null,
      h('p.muted.tip', {}, 'Clic en un pin para resaltar su red · Shift+clic para comparar varias redes · Ctrl+K para buscar.'),
    );
  }

  private header(eyebrow: string, title: string, badges: (string | HTMLElement)[], actions: HTMLElement[]): HTMLElement[] {
    return [
      h('div.eyebrow', {}, eyebrow),
      h('h2.title', { title }, title),
      h('div.badges', {}, ...badges.map((x) => (typeof x === 'string' ? h('span.badge', {}, x) : x))),
      h('div.actions', {}, ...actions),
    ];
  }

  private btn(label: string, ico: Parameters<typeof icon>[0], fn: () => void, primary = false): HTMLElement {
    return h('button.btn' + (primary ? '.primary' : ''), { onclick: fn }, icon(ico), label);
  }

  private partView(b: Board, id: number): HTMLElement[] {
    const part = b.parts[id];
    const netsOnPart = new Set(part.pins.map((p) => b.pins[p].net));
    const rows: PinRow[] = part.pins
      .map((pid) => {
        const pin = b.pins[pid];
        const net = b.nets[pin.net];
        return { pin: pid, a: pin.num + (pin.name && pin.name !== pin.num ? ` (${pin.name})` : ''), b: net.name, kind: net.kind, noted: !!this.notes.get(annotationKey(b, 'pin', pid)) };
      })
      .sort((x, y) => collator.compare(x.a, y.a));
    this.list.setItems(rows);
    const actions = [this.btn('Centrar', 'fit', () => this.actions.focus({ kind: 'part', id }), true)];
    if (this.actions.pdfAvailable()) actions.push(this.btn('En esquema', 'pdf', () => this.actions.searchPdf(part.name)));
    return [
      h('div.panel', {},
        ...this.header('Componente', part.name, [SIDE_TEXT[part.side], part.smd ? 'SMD' : 'Through-hole', `${part.pins.length} pines`, `${netsOnPart.size} redes`], actions),
        part.mfg ? h('p.mfg', {}, part.mfg) : null,
        h('div.kv', {}, h('span', {}, 'Centro'), h('b', {}, `${this.fmt(part.rect.cx)}, ${this.fmt(part.rect.cy)}`), h('span', {}, 'Cuerpo'), h('b', {}, `${this.fmt(part.rect.w)} × ${this.fmt(part.rect.h)}`)),
        this.noteEditor('part', id),
        h('div.eyebrow', {}, 'Pines'),
      ),
      h('div.pin-table', {}, this.list.el),
    ];
  }

  private netView(b: Board, id: number): HTMLElement[] {
    const net = b.nets[id];
    const parts = new Map<number, string[]>();
    for (const pid of net.pins) {
      const p = b.pins[pid];
      const list = parts.get(p.part) ?? [];
      list.push(p.num);
      parts.set(p.part, list);
    }
    const rows: PinRow[] = net.pins
      .map((pid) => {
        const p = b.pins[pid];
        return { pin: pid, a: `${b.parts[p.part]?.name ?? '?'}.${p.num}`, b: SIDE_TEXT[p.side], kind: net.kind, noted: !!this.notes.get(annotationKey(b, 'pin', pid)) };
      })
      .sort((x, y) => collator.compare(x.a, y.a));
    this.list.setItems(rows);
    const pinned = this.actions.isPinned(id);
    const actions = [
      this.btn('Encuadrar', 'fit', () => this.actions.focus({ kind: 'net', id }), true),
      this.btn(pinned ? 'Desfijar' : 'Fijar', 'pin', () => this.actions.togglePinnedNet(id)),
    ];
    if (this.actions.pdfAvailable()) actions.push(this.btn('En esquema', 'pdf', () => this.actions.searchPdf(net.name)));
    return [
      h('div.panel', {},
        ...this.header('Red', net.name, [h(`span.badge.kind-${net.kind}`, {}, KIND_TEXT[net.kind]), `${net.pins.length} pines`, `${parts.size} componentes`, ...(net.nails.length ? [`${net.nails.length} TP`] : [])], actions),
        this.noteEditor('net', id),
        h('div.eyebrow', {}, 'Conexiones'),
      ),
      h('div.pin-table', {}, this.list.el),
    ];
  }

  private pinView(b: Board, id: number): HTMLElement[] {
    const pin = b.pins[id];
    const part = b.parts[pin.part];
    const net = b.nets[pin.net];
    const kv = (k: string, v: string) => [h('span', {}, k), h('b', {}, v)];
    return [
      h('div.panel', {},
        ...this.header('Pin', `${part?.name ?? '?'}.${pin.num}`, [h(`span.badge.kind-${net.kind}`, {}, KIND_TEXT[net.kind]), SIDE_TEXT[pin.side]], [
          this.btn(net.name, 'net', () => this.actions.select({ kind: 'net', id: net.id }), true),
          this.btn(part?.name ?? '?', 'chip', () => this.actions.select({ kind: 'part', id: pin.part })),
        ]),
        h('div.kv', {},
          ...kv('Red', net.name),
          ...kv('Pines en la red', String(net.pins.length)),
          ...(pin.name ? kv('Nombre', pin.name) : []),
          ...kv('Posición', `${this.fmt(pin.x)}, ${this.fmt(pin.y)}`),
          ...kv('Radio pad', this.fmt(pin.r)),
          ...(pin.probe !== undefined && pin.probe >= 0 ? kv('Probe', String(pin.probe)) : []),
        ),
        this.noteEditor('pin', id),
      ),
    ];
  }

  /** Inline bench-measurement editor; saves on input with debounce. */
  private noteEditor(kind: TargetKind, id: number): HTMLElement {
    const b = this.board!;
    const key = annotationKey(b, kind, id);
    const cur = this.notes.get(key);
    const field = (label: string, unit: string, value: string | undefined) => {
      const input = h('input.input.mono', { value: value ?? '', placeholder: '—', inputmode: 'decimal' }) as HTMLInputElement;
      return { input, el: h('label.meas', {}, h('span', {}, label), input, h('i', {}, unit)) };
    };
    const diode = field('Diodo', 'V', cur?.diode);
    const volt = field('Tensión', 'V', cur?.voltage);
    const res = field('Resist.', 'Ω', cur?.resistance);
    const note = h('textarea.input', { rows: 2, placeholder: 'Nota de diagnóstico…' }) as HTMLTextAreaElement;
    note.value = cur?.note ?? '';
    let t = 0;
    const save = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        this.notes.upsert({ key, note: note.value, diode: diode.input.value, voltage: volt.input.value, resistance: res.input.value });
      }, 450);
    };
    for (const el of [diode.input, volt.input, res.input, note]) {
      el.addEventListener('input', save);
      el.addEventListener('keydown', (e) => e.stopPropagation());
    }
    return h('details.notes' + (cur ? '.has' : ''), { open: cur ? true : undefined },
      h('summary', {}, icon('note'), 'Mediciones y notas', cur ? h('span.saved', {}, 'guardado') : null),
      h('div.meas-grid', {}, diode.el, volt.el, res.el),
      note,
    );
  }
}
