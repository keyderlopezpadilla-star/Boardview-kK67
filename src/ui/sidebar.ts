import type { AnnotationStore } from '../core/annotations';
import { fuzzyScore } from '../core/search';
import type { Selection } from '../core/store';
import type { Board, NetKind } from '../core/types';
import { h, icon } from './dom';
import { VirtualList } from './virtualList';

type Tab = 'parts' | 'nets' | 'notes';
type Row = { kind: 'part' | 'net' | 'note'; id: number; key: string; label: string; meta: string; tag: string; noteKey?: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const KIND_NAMES: Record<NetKind, string> = { power: 'Alimentación', ground: 'Masa', signal: 'Señal', nc: 'Sin conexión' };

export class Sidebar {
  readonly el: HTMLElement;
  private tab: Tab = 'parts';
  private filter: HTMLInputElement;
  private list: VirtualList<Row>;
  private board: Board | null = null;
  private partRows: Row[] = [];
  private netRows: Row[] = [];
  private kindFilter: NetKind | 'all' = 'all';
  private tabs: Record<Tab, HTMLElement>;
  private chips: HTMLElement;
  private countEl: HTMLElement;

  constructor(
    private notes: AnnotationStore,
    private onSelect: (sel: Exclude<Selection, null>, additive: boolean) => void,
    private onNoteSelect: (key: string) => void,
  ) {
    this.filter = h('input.input', { placeholder: 'Filtrar…', spellcheck: 'false' }) as HTMLInputElement;
    this.filter.addEventListener('input', () => this.refresh());
    this.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.filter.value = '';
        this.refresh();
        this.filter.blur();
      }
      e.stopPropagation();
    });

    this.list = new VirtualList<Row>(
      30,
      (r) =>
        h('div.row-item', { role: 'option' },
          h(`span.dot.${r.tag}`),
          h('span.row-label', {}, r.label),
          h('span.row-meta', { title: r.meta }, r.meta),
        ),
      (r) => r.key,
      (r, ev) => {
        if (r.kind === 'note') this.onNoteSelect(r.noteKey!);
        else this.onSelect({ kind: r.kind, id: r.id }, ev.shiftKey);
      },
    );

    const mkTab = (t: Tab, label: string, ico: Parameters<typeof icon>[0]) =>
      h('button.tab', { onclick: () => this.setTab(t), role: 'tab' }, icon(ico), h('span', {}, label));
    this.tabs = { parts: mkTab('parts', 'Componentes', 'chip'), nets: mkTab('nets', 'Redes', 'net'), notes: mkTab('notes', 'Notas', 'note') };

    this.chips = h('div.chips', {},
      ...(['all', 'power', 'signal', 'ground', 'nc'] as const).map((k) =>
        h(`button.chip${k === 'all' ? '.on' : ''}`, { 'data-k': k, onclick: () => this.setKind(k) }, k !== 'all' ? h(`span.dot.${k}`) : null, k === 'all' ? 'Todas' : KIND_NAMES[k]),
      ),
    );
    this.countEl = h('span.count');

    this.el = h('aside.sidebar', {},
      h('div.tabs', { role: 'tablist' }, this.tabs.parts, this.tabs.nets, this.tabs.notes),
      h('div.sidebar-tools', {}, h('div.search-field', {}, icon('search'), this.filter), this.countEl),
      this.chips,
      this.list.el,
    );
    this.notes.onChange(() => this.tab === 'notes' && this.refresh());
    this.setTab('parts');
  }

  setBoard(board: Board | null): void {
    this.board = board;
    if (!board) {
      this.partRows = this.netRows = [];
      this.refresh();
      return;
    }
    this.partRows = board.parts
      .filter((p) => !p.virtual)
      .map((p) => ({
        kind: 'part' as const, id: p.id, key: `part:${p.id}`, label: p.name,
        meta: p.mfg ? `${p.pins.length}p · ${p.mfg}` : `${p.pins.length} pines`,
        tag: p.side === 'top' ? 'side-t' : p.side === 'bottom' ? 'side-b' : 'side-x',
      }))
      .sort((a, b) => collator.compare(a.label, b.label));
    this.netRows = board.nets
      // Auto-generated per-pin "NC@n" nets are noise in the list (still reachable via their pin).
      .filter((n) => !/^NC@\d+$/.test(n.name))
      .map((n) => ({ kind: 'net' as const, id: n.id, key: `net:${n.id}`, label: n.name, meta: `${n.pins.length + n.nails.length}`, tag: n.kind }))
      .sort((a, b) => collator.compare(a.label, b.label));
    this.refresh();
  }

  setActive(sel: Selection): void {
    if (!sel || !this.board) return this.list.setActive(null, false);
    if (sel.kind === 'part' && this.tab === 'parts') this.list.setActive(`part:${sel.id}`);
    else if (this.tab === 'nets') {
      const net = sel.kind === 'net' ? sel.id : sel.kind === 'pin' ? this.board.pins[sel.id].net : -1;
      this.list.setActive(net >= 0 ? `net:${net}` : null);
    } else if (sel.kind === 'pin' && this.tab === 'parts') this.list.setActive(`part:${this.board.pins[sel.id].part}`);
  }

  setTab(t: Tab): void {
    this.tab = t;
    for (const [k, el] of Object.entries(this.tabs)) el.classList.toggle('on', k === t);
    this.chips.style.display = t === 'nets' ? '' : 'none';
    this.filter.placeholder = t === 'parts' ? 'Filtrar componentes…' : t === 'nets' ? 'Filtrar redes…' : 'Filtrar notas…';
    this.refresh();
  }

  focusFilter(): void {
    this.filter.focus();
    this.filter.select();
  }

  private setKind(k: NetKind | 'all'): void {
    this.kindFilter = k;
    this.chips.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === k));
    this.refresh();
  }

  private refresh(): void {
    let rows: Row[];
    if (this.tab === 'parts') rows = this.partRows;
    else if (this.tab === 'nets') rows = this.kindFilter === 'all' ? this.netRows : this.netRows.filter((r) => r.tag === this.kindFilter);
    else
      rows = this.notes.all().map((a, i) => ({
        kind: 'note' as const, id: i, key: `note:${a.key}`, noteKey: a.key,
        label: a.key.replace(/^(pin|part|net):/, ''),
        meta: [a.diode && `D ${a.diode}`, a.voltage && `${a.voltage} V`, a.resistance && `${a.resistance} Ω`, a.note].filter(Boolean).join(' · '),
        tag: 'note',
      }));

    const q = this.filter.value.trim().toUpperCase();
    if (q) {
      rows = rows
        .map((r) => ({ r, s: Math.max(fuzzyScore(r.label.toUpperCase(), q), fuzzyScore(r.meta.toUpperCase(), q) * 0.5) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);
    }
    this.countEl.textContent = rows.length.toLocaleString();
    this.list.setItems(rows);
    if (!rows.length && this.tab === 'notes' && !q) {
      this.countEl.textContent = '0';
    }
  }
}
