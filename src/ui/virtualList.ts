import { h } from './dom';

/**
 * Fixed-row-height virtualised list. Renders only visible rows so lists of
 * 50k nets scroll at 60fps.
 */
export class VirtualList<T> {
  readonly el: HTMLElement;
  private spacer: HTMLElement;
  private body: HTMLElement;
  private items: T[] = [];
  private activeKey: string | null = null;
  private raf = 0;

  constructor(
    private rowHeight: number,
    private renderRow: (item: T, index: number) => HTMLElement,
    private keyOf: (item: T) => string,
    private onPick: (item: T, ev: MouseEvent) => void,
  ) {
    this.spacer = h('div.vl-spacer');
    this.body = h('div.vl-body');
    this.el = h('div.vl', { role: 'listbox', tabindex: 0 }, this.spacer, this.body);
    this.el.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(this.el);
    this.body.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
      if (row) this.onPick(this.items[Number(row.dataset.idx)], e);
    });
  }

  setItems(items: T[]): void {
    this.items = items;
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    this.schedule();
  }

  setActive(key: string | null, scrollIntoView = true): void {
    this.activeKey = key;
    if (key && scrollIntoView) {
      const idx = this.items.findIndex((it) => this.keyOf(it) === key);
      if (idx >= 0) {
        const top = idx * this.rowHeight;
        if (top < this.el.scrollTop || top > this.el.scrollTop + this.el.clientHeight - this.rowHeight) {
          this.el.scrollTop = top - this.el.clientHeight / 2;
        }
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const { scrollTop, clientHeight } = this.el;
    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - 6);
    const end = Math.min(this.items.length, Math.ceil((scrollTop + clientHeight) / this.rowHeight) + 6);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const row = this.renderRow(this.items[i], i);
      row.dataset.idx = String(i);
      row.style.transform = `translateY(${i * this.rowHeight}px)`;
      row.style.height = `${this.rowHeight}px`;
      if (this.keyOf(this.items[i]) === this.activeKey) row.classList.add('active');
      frag.append(row);
    }
    this.body.replaceChildren(frag);
  }
}
