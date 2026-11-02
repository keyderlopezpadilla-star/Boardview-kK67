import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './pdf-text-layer.css';
import { h, icon } from './dom';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItemLite {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PageSlot {
  el: HTMLElement;
  page?: PDFPageProxy;
  rendered: boolean;
  rendering: boolean;
  items?: TextItemLite[];
  text?: string; // upper-cased concatenation with item offsets
  offsets?: number[];
  marks: HTMLElement;
}

interface Match {
  page: number;
  item: number;
  start: number;
  len: number;
}

/**
 * Schematic viewer: lazily rendered pages, selectable text layer, whole-word
 * search with highlights, and a callback when the user selects a token so the
 * board can jump to the matching part or net.
 */
export class PdfPane {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private input: HTMLInputElement;
  private counter: HTMLElement;
  private title: HTMLElement;
  private doc: PDFDocumentProxy | null = null;
  private slots: PageSlot[] = [];
  private zoom = 1.4;
  private matches: Match[] = [];
  private cursor = -1;
  private observer: IntersectionObserver;
  private baseSize = { w: 612, h: 792 };
  private loadToken = 0;

  constructor(private onTokenPicked: (text: string) => void, private onClose: () => void) {
    this.input = h('input.input', { placeholder: 'Buscar en esquema…  (Enter)', spellcheck: 'false' }) as HTMLInputElement;
    this.counter = h('span.pdf-count', {}, '');
    this.title = h('span.pdf-title', {}, 'Esquemático');
    const btn = (ico: Parameters<typeof icon>[0], title: string, fn: () => void) =>
      h('button.icon-btn', { title, onclick: fn }, icon(ico));

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.matches.length && this.input.dataset.q === this.input.value) this.step(e.shiftKey ? -1 : 1);
        else void this.search(this.input.value);
      }
      if (e.key === 'Escape') this.input.blur();
      e.stopPropagation();
    });

    this.scroller = h('div.pdf-scroller');
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.scroller,
      rootMargin: '600px 0px',
    });

    this.scroller.addEventListener('mouseup', () => {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length <= 64 && !/\s{2,}/.test(sel)) this.onTokenPicked(sel);
    });
    this.scroller.addEventListener('dblclick', () => {
      const sel = window.getSelection()?.toString().trim();
      if (sel) this.onTokenPicked(sel);
    });
    this.scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    const splitter = h('div.splitter', { title: 'Arrastra para redimensionar' });
    this.bindSplitter(splitter);
    this.el = h('aside.pdf-pane',
      {},
      splitter,
      h('div.pdf-head', {},
        h('div.pdf-head-row', {}, icon('pdf'), this.title, h('span.grow'), btn('minus', 'Alejar', () => this.setZoom(this.zoom / 1.2)), btn('plus', 'Acercar', () => this.setZoom(this.zoom * 1.2)), btn('close', 'Cerrar esquema', () => this.onClose())),
        h('div.pdf-head-row', {}, h('div.search-field', {}, icon('search'), this.input), this.counter, btn('prev', 'Anterior (Shift+Enter)', () => this.step(-1)), btn('next', 'Siguiente (Enter)', () => this.step(1))),
      ),
      this.scroller,
    );
  }

  /** Drag handle on the left edge; width persisted per browser. */
  private bindSplitter(handle: HTMLElement): void {
    const root = document.documentElement;
    try {
      const saved = localStorage.getItem('kk67.pdfWidth');
      if (saved) root.style.setProperty('--pdf-w', saved);
    } catch {
      /* storage unavailable */
    }
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('drag');
      const move = (ev: PointerEvent) => {
        const w = Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth * 0.75);
        root.style.setProperty('--pdf-w', `${Math.round(w)}px`);
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        handle.classList.remove('drag');
        handle.removeEventListener('pointermove', move);
        try {
          localStorage.setItem('kk67.pdfWidth', root.style.getPropertyValue('--pdf-w'));
        } catch {
          /* storage unavailable */
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  }

  get loaded(): boolean {
    return !!this.doc;
  }

  async open(name: string, data: Uint8Array): Promise<void> {
    const token = ++this.loadToken;
    await this.doc?.destroy();
    this.doc = null;
    this.slots = [];
    this.scroller.replaceChildren(h('div.pdf-loading', {}, 'Cargando esquema…'));
    this.title.textContent = name.split(/[\\/]/).pop() ?? name;
    this.title.title = name;
    // pdf.js takes ownership of the buffer — hand it a copy.
    const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
    if (token !== this.loadToken) {
      void doc.destroy();
      return;
    }
    this.doc = doc;
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    this.baseSize = { w: vp.width, h: vp.height };
    // Open fitted to the pane width (schematics are usually landscape A3/A4).
    const avail = this.scroller.clientWidth - 48;
    if (avail > 100) this.zoom = Math.min(6, Math.max(0.4, avail / vp.width));
    this.scroller.replaceChildren();
    for (let i = 0; i < doc.numPages; i++) {
      const marks = h('div.pdf-marks');
      const el = h('div.pdf-page', { 'data-page': i }, h('div.pdf-page-num', {}, String(i + 1)), marks);
      this.slots.push({ el, rendered: false, rendering: false, marks });
      this.layoutSlot(i);
      this.scroller.append(el);
      this.observer.observe(el);
    }
    this.counter.textContent = `${doc.numPages} pág.`;
  }

  private layoutSlot(i: number): void {
    const s = this.slots[i];
    const vp = s.page?.getViewport({ scale: this.zoom });
    const w = vp ? vp.width : this.baseSize.w * this.zoom;
    const hgt = vp ? vp.height : this.baseSize.h * this.zoom;
    s.el.style.width = `${w}px`;
    s.el.style.height = `${hgt}px`;
    s.el.style.setProperty('--scale-factor', String(this.zoom));
  }

  private setZoom(z: number): void {
    const anchor = this.scroller.scrollTop / Math.max(1, this.scroller.scrollHeight);
    this.zoom = Math.min(6, Math.max(0.4, z));
    this.slots.forEach((s, i) => {
      this.unrender(s);
      this.layoutSlot(i);
    });
    this.scroller.scrollTop = anchor * this.scroller.scrollHeight;
    // re-trigger observation for visible pages
    for (const s of this.slots) {
      this.observer.unobserve(s.el);
      this.observer.observe(s.el);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      const idx = Number((e.target as HTMLElement).dataset.page);
      const slot = this.slots[idx];
      if (!slot) continue;
      if (e.isIntersecting) void this.renderSlot(idx);
      else if (slot.rendered) this.unrender(slot);
    }
  }

  private unrender(s: PageSlot): void {
    s.el.querySelectorAll('canvas, .textLayer').forEach((n) => n.remove());
    s.rendered = false;
  }

  private async renderSlot(i: number): Promise<void> {
    const s = this.slots[i];
    if (!this.doc || s.rendered || s.rendering) return;
    s.rendering = true;
    try {
      s.page ??= await this.doc.getPage(i + 1);
      this.layoutSlot(i);
      const vp = s.page.getViewport({ scale: this.zoom });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = h('canvas') as HTMLCanvasElement;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const zoomAtStart = this.zoom;
      await s.page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
      if (zoomAtStart !== this.zoom) return;
      const textDiv = h('div.textLayer');
      s.el.prepend(canvas);
      s.el.insertBefore(textDiv, s.marks);
      await new pdfjs.TextLayer({ textContentSource: s.page.streamTextContent(), container: textDiv, viewport: vp }).render();
      s.rendered = true;
      this.paintMarks(i);
    } catch (err) {
      console.warn('PDF render', err);
    } finally {
      s.rendering = false;
    }
  }

  private async ensureText(i: number): Promise<PageSlot> {
    const s = this.slots[i];
    if (s.text !== undefined) return s;
    s.page ??= await this.doc!.getPage(i + 1);
    const tc = await s.page.getTextContent();
    s.items = (tc.items as TextItemLite[]).filter((it) => typeof it.str === 'string');
    const offsets: number[] = [];
    let text = '';
    for (const it of s.items) {
      offsets.push(text.length);
      text += it.str.toUpperCase() + '\u0000';
    }
    s.text = text;
    s.offsets = offsets;
    return s;
  }

  /** Whole-token search first; falls back to substring when nothing matches exactly. */
  async search(query: string, opts: { quiet?: boolean } = {}): Promise<number> {
    const q = query.trim().toUpperCase();
    this.input.value = query;
    this.input.dataset.q = query;
    if (!this.doc || !q) return 0;
    const run = async (whole: boolean) => {
      const found: Match[] = [];
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = whole ? new RegExp(`(?<![A-Z0-9_+])${esc}(?![A-Z0-9_])`, 'g') : new RegExp(esc, 'g');
      for (let i = 0; i < this.slots.length; i++) {
        const s = await this.ensureText(i);
        s.items!.forEach((it, idx) => {
          const t = it.str.toUpperCase();
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(t))) found.push({ page: i, item: idx, start: m.index, len: q.length });
        });
      }
      return found;
    };
    this.matches = await run(true);
    if (!this.matches.length) this.matches = await run(false);
    this.cursor = -1;
    this.slots.forEach((_, i) => this.paintMarks(i));
    this.counter.textContent = this.matches.length ? `0/${this.matches.length}` : 'sin resultados';
    if (this.matches.length) this.step(1);
    else if (!opts.quiet) this.input.classList.add('shake');
    setTimeout(() => this.input.classList.remove('shake'), 400);
    return this.matches.length;
  }

  step(dir: number): void {
    if (!this.matches.length) return;
    this.cursor = (this.cursor + dir + this.matches.length) % this.matches.length;
    this.counter.textContent = `${this.cursor + 1}/${this.matches.length}`;
    const m = this.matches[this.cursor];
    const rect = this.matchRect(m);
    const slot = this.slots[m.page];
    const top = slot.el.offsetTop + (rect ? rect.y : 0) - this.scroller.clientHeight / 2;
    const left = slot.el.offsetLeft + (rect ? rect.x : 0) - this.scroller.clientWidth / 2;
    this.scroller.scrollTo({ top, left, behavior: 'smooth' });
    this.slots.forEach((_, i) => this.paintMarks(i));
  }

  private matchRect(m: Match): { x: number; y: number; w: number; h: number } | null {
    const s = this.slots[m.page];
    const it = s.items?.[m.item];
    if (!it) return null;
    const vp = s.page?.getViewport({ scale: this.zoom });
    if (!vp) return null;
    const [, , , , e, f] = it.transform;
    const fontH = Math.hypot(it.transform[2], it.transform[3]) || it.height || 8;
    const len = Math.max(1, it.str.length);
    const x0 = e + (it.width * m.start) / len;
    const x1 = e + (it.width * (m.start + m.len)) / len;
    const [ax, ay, bx, by] = vp.convertToViewportRectangle([x0, f - fontH * 0.25, x1, f + fontH * 0.95]);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  private paintMarks(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    const frag = document.createDocumentFragment();
    this.matches.forEach((m, idx) => {
      if (m.page !== i) return;
      const r = this.matchRect(m);
      if (!r) return;
      const mark = h('div.pdf-mark' + (idx === this.cursor ? '.current' : ''));
      mark.style.cssText = `left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px`;
      frag.append(mark);
    });
    s.marks.replaceChildren(frag);
  }
}
