import type { HitKind, SearchHit, SearchIndex } from '../core/search';
import { escapeHtml, h, icon } from './dom';

const KIND_ICON: Record<HitKind, 'chip' | 'net' | 'pin'> = { part: 'chip', net: 'net', pin: 'pin' };
const KIND_LABEL: Record<HitKind, string> = { part: 'Componente', net: 'Red', pin: 'Pin' };

/** Spotlight-style global search with keyboard navigation and match highlighting. */
export class CommandPalette {
  private backdrop: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private hits: SearchHit[] = [];
  private active = 0;
  private index: SearchIndex | null = null;

  constructor(private onPick: (hit: SearchHit, additive: boolean) => void) {
    this.input = h('input.palette-input', { placeholder: 'Buscar componente, red o pin (ej. U7000, PP3V3_S5, U1000.A12)…', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
    this.list = h('div.palette-list', { role: 'listbox' });
    const hint = h('div.palette-hint', {}, h('span', {}, h('kbd', {}, '↑↓'), ' navegar'), h('span', {}, h('kbd', {}, 'Enter'), ' abrir'), h('span', {}, h('kbd', {}, 'Shift+Enter'), ' fijar red'), h('span', {}, h('kbd', {}, 'Esc'), ' cerrar'));
    const box = h('div.palette', {}, h('div.palette-field', {}, icon('search'), this.input), this.list, hint);
    this.backdrop = h('div.backdrop.palette-backdrop', { onmousedown: (e: Event) => e.target === this.backdrop && this.close() }, box);

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { this.move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') { this.pick(this.active, e.shiftKey); e.preventDefault(); }
      else if (e.key === 'Escape') { this.close(); e.preventDefault(); }
      e.stopPropagation();
    });
    this.list.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row) {
        e.preventDefault();
        this.pick(Number(row.dataset.i), e.shiftKey);
      }
    });
  }

  setIndex(index: SearchIndex | null): void {
    this.index = index;
  }

  get isOpen(): boolean {
    return this.backdrop.isConnected;
  }

  open(prefill = ''): void {
    if (!this.index) return;
    document.body.append(this.backdrop);
    requestAnimationFrame(() => this.backdrop.classList.add('in'));
    this.input.value = prefill;
    this.update();
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.backdrop.classList.remove('in');
    setTimeout(() => this.backdrop.remove(), 150);
  }

  private update(): void {
    this.hits = this.index?.search(this.input.value, 80) ?? [];
    this.active = 0;
    this.render();
  }

  private move(d: number): void {
    if (!this.hits.length) return;
    this.active = (this.active + d + this.hits.length) % this.hits.length;
    this.render();
    this.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  private pick(i: number, additive: boolean): void {
    const hit = this.hits[i];
    if (!hit) return;
    this.close();
    this.onPick(hit, additive);
  }

  private render(): void {
    const q = this.input.value.trim().toUpperCase();
    if (!q) {
      this.list.replaceChildren(h('div.palette-empty', {}, 'Escribe para buscar. Soporta coincidencia parcial y difusa.'));
      return;
    }
    if (!this.hits.length) {
      this.list.replaceChildren(h('div.palette-empty', {}, 'Sin resultados'));
      return;
    }
    this.list.replaceChildren(
      ...this.hits.map((hit, i) =>
        h('div.palette-row' + (i === this.active ? '.active' : ''), { 'data-i': i, role: 'option' },
          h(`span.kind.k-${hit.kind}`, {}, icon(KIND_ICON[hit.kind])),
          h('span.label', { html: highlight(hit.label, q) }),
          h('span.detail', {}, hit.detail),
          h('span.badge', {}, KIND_LABEL[hit.kind]),
        ),
      ),
    );
  }
}

function highlight(label: string, q: string): string {
  const up = label.toUpperCase();
  const i = up.indexOf(q);
  if (i < 0) return escapeHtml(label);
  return `${escapeHtml(label.slice(0, i))}<mark>${escapeHtml(label.slice(i, i + q.length))}</mark>${escapeHtml(label.slice(i + q.length))}`;
}
