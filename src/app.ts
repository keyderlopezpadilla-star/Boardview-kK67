import { AnnotationStore, annotationKey } from './core/annotations';
import { rectCorners } from './core/geometry';
import { SearchIndex, type SearchHit } from './core/search';
import { Store, isVisible, loadSettings, saveSettings, type Selection, type Settings, type ViewSide } from './core/store';
import type { Board, Bounds, InputFile, Pt, WorkerRequest, WorkerResponse } from './core/types';
import { generateDemoBRD } from './demo/demoBoard';
import { SUPPORTED_EXTENSIONS } from './parsers';
import { parseFzKey } from './crypto/rc6';
import { Camera } from './render/camera';
import { Minimap } from './render/minimap';
import { BoardRenderer, PALETTES, type HitResult } from './render/renderer';
import { $, download, h, icon } from './ui/dom';
import { Inspector } from './ui/inspector';
import { chooseFile, openSettings, openShortcuts, toast } from './ui/modals';
import { CommandPalette } from './ui/palette';
import { PdfPane } from './ui/pdfPane';
import { Sidebar } from './ui/sidebar';

const NET_KIND_TEXT = { power: 'Alimentación', ground: 'Masa', signal: 'Señal', nc: 'Sin conexión' } as const;

export class App {
  private store = new Store({
    board: null, side: 'top', selection: null, pinnedNets: [], hover: null, settings: loadSettings(), measuring: false,
  });
  private notes = new AnnotationStore();
  private cam = new Camera();
  private renderer: BoardRenderer;
  private minimap: Minimap;
  private sidebar: Sidebar;
  private inspector: Inspector;
  private palette: CommandPalette;
  private pdf: PdfPane;
  private index: SearchIndex | null = null;
  private worker: Worker;
  private reqId = 0;
  private dirty = true;
  private lastFrame = performance.now();
  private measure: { a: Pt; b: Pt | null } | null = null;
  private annotatedPins = new Set<number>();
  private annotationLabels = new Map<number, string>();

  // DOM
  private root: HTMLElement;
  private stage!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private tooltip!: HTMLElement;
  private welcome!: HTMLElement;
  private dropzone!: HTMLElement;
  private busy!: HTMLElement;
  private status!: Record<'coords' | 'zoom' | 'side' | 'counts' | 'format' | 'mode', HTMLElement>;
  private sideButtons!: Record<ViewSide, HTMLElement>;
  private fileChip!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private pdfToggle!: HTMLElement;
  private measureBtn!: HTMLElement;
  private mirrorBtn!: HTMLElement;
  private sidebarBtn!: HTMLElement;
  private inspectorBtn!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.worker = new Worker(new URL('./worker/parse.worker.ts', import.meta.url), { type: 'module' });

    this.notes.onChange(() => this.refreshAnnotations());
    this.sidebar = new Sidebar(this.notes, (sel, add) => this.select(sel, { additive: add, focus: true }), (key) => this.selectNoteKey(key));
    this.inspector = new Inspector(this.notes, {
      select: (sel, add) => this.select(sel, { additive: add, focus: sel.kind === 'pin' }),
      focus: (sel) => this.focusOn(sel),
      searchPdf: (t) => this.searchPdf(t, true),
      togglePinnedNet: (n) => this.togglePinned(n),
      isPinned: (n) => this.store.state.pinnedNets.includes(n),
      pdfAvailable: () => this.pdf.loaded,
    }, () => this.store.state.settings);
    this.palette = new CommandPalette((hit, add) => this.onSearchHit(hit, add));
    this.pdf = new PdfPane((t) => this.onPdfToken(t), () => this.togglePdf(false));

    this.buildLayout();
    this.renderer = new BoardRenderer(this.canvas);
    this.minimap = new Minimap($('.minimap', this.root) as HTMLCanvasElement, (x, y) => {
      this.cam.flyTo(x, y);
      this.invalidate();
    });
    this.applyTheme();
    this.bindStage();
    this.bindKeys();
    this.bindDrop();

    this.store.subscribe((s, changed) => this.onState(s, changed));
    new ResizeObserver(() => this.resize()).observe(this.stage);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ================================================================== */
  /* Layout                                                              */
  /* ================================================================== */

  private buildLayout(): void {
    const tb = (ico: Parameters<typeof icon>[0], title: string, fn: () => void, extra = '') =>
      h(`button.icon-btn${extra}`, { title, 'aria-label': title, onclick: fn }, icon(ico));

    this.fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: SUPPORTED_EXTENSIONS.join(',') }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) void this.openFiles([...this.fileInput.files]);
      this.fileInput.value = '';
    });

    this.sideButtons = {
      top: h('button.seg', { onclick: () => this.setSide('top'), title: 'Cara superior' }, 'Top'),
      bottom: h('button.seg', { onclick: () => this.setSide('bottom'), title: 'Cara inferior' }, 'Bottom'),
      both: h('button.seg', { onclick: () => this.setSide('both'), title: 'Ambas caras' }, 'Ambas'),
    };
    this.fileChip = h('div.file-chip', {}, 'Sin archivo');
    this.pdfToggle = tb('pdf', 'Esquema PDF (P)', () => this.togglePdf());
    this.measureBtn = tb('ruler', 'Medir distancia (M)', () => this.toggleMeasure());
    this.mirrorBtn = tb('flip', 'Espejo horizontal (X)', () => this.toggleMirror());
    this.sidebarBtn = tb('panelLeft', 'Panel de listas ([)', () => this.togglePanel('sidebar'), '.on');
    this.inspectorBtn = tb('panelRight', 'Inspector (])', () => this.togglePanel('inspector'), '.on');

    const topbar = h('header.topbar', {},
      h('div.brand', {}, h('span.logo', { html: LOGO }), h('div.brand-text', {}, h('b', {}, 'Boardview'), h('span', {}, 'KK67 Pro'))),
      this.sidebarBtn,
      h('button.btn.primary.open-btn', { onclick: () => this.fileInput.click(), title: 'Abrir (Ctrl+O)' }, icon('open'), h('span', {}, 'Abrir')),
      this.fileChip,
      h('div.sep'),
      h('div.segmented', { role: 'group', 'aria-label': 'Cara' }, this.sideButtons.top, this.sideButtons.bottom, this.sideButtons.both),
      tb('rotate', 'Rotar 90° (R)', () => this.rotate(1)),
      this.mirrorBtn,
      tb('fit', 'Encuadrar (F)', () => this.fit()),
      this.measureBtn,
      h('div.grow'),
      h('button.search-trigger', { onclick: () => this.palette.open(), title: 'Buscar (Ctrl+K)' }, icon('search'), h('span', {}, 'Buscar componente, red o pin…'), h('kbd', {}, '⌘K')),
      this.pdfToggle,
      this.inspectorBtn,
      tb('camera', 'Captura PNG', () => this.screenshot()),
      tb('settings', 'Ajustes', () => this.openSettings()),
      h('button.icon-btn.kbd-btn', { title: 'Atajos de teclado (?)', onclick: () => openShortcuts() }, '?'),
      this.fileInput,
    );

    this.canvas = h('canvas.board-canvas') as HTMLCanvasElement;
    this.tooltip = h('div.tooltip');
    this.busy = h('div.busy', {}, h('div.spinner'), h('span', {}, 'Procesando…'));
    this.dropzone = h('div.dropzone', {}, h('div.dropzone-inner', {}, icon('upload'), h('b', {}, 'Suelta tu boardview aquí'), h('span', {}, '.brd .bdv .fz .cad .pcb .bvr .asc .cst · .zip · .pdf')));
    this.welcome = this.buildWelcome();

    this.stage = h('section.stage', {},
      this.canvas,
      h('canvas.minimap', { title: 'Mapa: clic para navegar' }),
      h('div.legend', {}, ...(['power', 'signal', 'ground', 'nc'] as const).map((k) => h('span', {}, h(`span.dot.${k}`), NET_KIND_TEXT[k]))),
      h('div.zoom-ctrl', {},
        h('button.icon-btn', { title: 'Acercar (+)', onclick: () => this.zoomCenter(1.4) }, icon('plus')),
        h('button.icon-btn', { title: 'Alejar (−)', onclick: () => this.zoomCenter(1 / 1.4) }, icon('minus')),
      ),
      this.tooltip,
      this.welcome,
      this.dropzone,
      this.busy,
    );

    const s = (cls: string) => h(`span.${cls}`);
    this.status = { coords: s('st-coords'), zoom: s('st-zoom'), side: s('st-side'), counts: s('st-counts'), format: s('st-format'), mode: s('st-mode') };
    const statusbar = h('footer.statusbar', {}, this.status.mode, this.status.coords, this.status.zoom, this.status.side, h('span.grow'), this.status.counts, this.status.format);

    const main = h('div.main', {}, this.sidebar.el, this.stage, this.inspector.el, this.pdf.el);
    this.root.replaceChildren(topbar, main, statusbar);
    this.root.classList.add('no-pdf');
  }

  private buildWelcome(): HTMLElement {
    const formats = [
      ['BRD', 'Test_Link / OBV, normal y cifrado'], ['BRD2', 'BRDOUT (Gigabyte, MSI)'], ['BDV', 'HONHAN'], ['ASC', 'TSICT (ASUS/Pegatron)'],
      ['BVR / BVR3', 'BVRAW 1 y 3'], ['CAD', 'GenCAD 1.4 y Panel CAD'], ['FZ', 'ASUS (clave RC6)'], ['PCB', 'XZZ (clave DES)'], ['CST', 'Castw'], ['ZIP', 'Paquetes + PDF'],
    ];
    return h('div.welcome', {},
      h('div.welcome-card', {},
        h('div.welcome-logo', { html: LOGO }),
        h('h1', {}, 'Boardview ', h('span.grad', {}, 'KK67 Pro')),
        h('p.lead', {}, 'Visor profesional de boardviews para diagnóstico de placas de portátiles. Resaltado de redes, enlace con esquemáticos PDF, mediciones en banco y navegación fluida a 60 fps.'),
        h('div.welcome-actions', {},
          h('button.btn.primary.lg', { onclick: () => this.fileInput.click() }, icon('open'), 'Abrir boardview'),
          h('button.btn.lg', { onclick: () => void this.loadDemo() }, icon('sparkle'), 'Cargar placa de muestra'),
        ),
        h('p.muted.small', {}, 'O arrastra archivos aquí. Todo se procesa localmente en tu navegador: ningún archivo sale de tu equipo.'),
        h('div.format-grid', {}, ...formats.map(([f, d]) => h('div.format', {}, h('b', {}, f), h('span', {}, d)))),
      ),
    );
  }

  /* ================================================================== */
  /* Loading                                                             */
  /* ================================================================== */

  async openFiles(list: File[]): Promise<void> {
    const files: InputFile[] = await Promise.all(list.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await this.parse(files);
  }

  private parse(files: InputFile[], pick?: string): Promise<void> {
    const id = ++this.reqId;
    this.busy.classList.add('on');
    const s = this.store.state.settings;
    const fz = parseFzKey(s.fzKey);
    const req: WorkerRequest = { id, type: 'parse', files, keys: { fz: fz.length === 44 ? fz : undefined, xzz: s.xzzKey.trim() || undefined }, pick };
    return new Promise((resolve) => {
      const onMsg = async (ev: MessageEvent<WorkerResponse>) => {
        if (ev.data.id !== id) return;
        this.worker.removeEventListener('message', onMsg);
        this.busy.classList.remove('on');
        const res = ev.data;
        if (res.type === 'error') {
          toast(res.message, 'error', 6500);
        } else if (res.type === 'choose') {
          const chosen = await chooseFile(res.candidates);
          if (chosen) await this.parse(files, chosen);
        } else {
          if (res.board) this.setBoard(res.board);
          if (res.attachments.length) {
            const pdf = res.attachments.sort((a, b) => b.data.length - a.data.length)[0];
            await this.openPdf(pdf.name, pdf.data);
            if (res.attachments.length > 1) toast(`${res.attachments.length} PDFs encontrados; abierto el más grande: ${pdf.name}`);
          }
        }
        resolve();
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.postMessage(req);
    });
  }

  /** Demo = procedural board + matching schematic so board↔PDF linking can be tried immediately. */
  async loadDemo(): Promise<void> {
    const files: InputFile[] = [{ name: 'KK67-DEMO-MLB.brd', data: new TextEncoder().encode(generateDemoBRD()) }];
    try {
      const res = await fetch(new URL('demo/KK67-DEMO-schematic.pdf', document.baseURI));
      if (res.ok) files.push({ name: 'KK67-DEMO-schematic.pdf', data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      /* offline without the asset: board alone is fine */
    }
    await this.parse(files);
  }

  private setBoard(board: Board): void {
    this.renderer.setBoard(board);
    this.index = new SearchIndex(board);
    this.palette.setIndex(this.index);
    this.notes.load(board);
    this.sidebar.setBoard(board);
    this.inspector.setBoard(board);
    this.measure = null;
    this.cam.rotation = 0;
    this.cam.mirror = false;
    // Landscape boards fit better unrotated; portrait ones rotate to use wide screens.
    const bw = board.bounds.maxX - board.bounds.minX;
    const bh = board.bounds.maxY - board.bounds.minY;
    if (bh > bw * 1.25 && this.cam.width > this.cam.height) this.cam.rotation = 1;
    this.store.set({ board, selection: null, pinnedNets: [], hover: null, side: 'top' });
    this.cam.fit(board.bounds, 48, true);
    this.welcome.classList.add('hidden');
    this.fileChip.textContent = board.fileName;
    this.fileChip.title = board.fileName;
    this.status.format.textContent = board.format;
    this.status.counts.textContent = `${board.parts.filter((p) => !p.virtual).length.toLocaleString()} comp · ${board.pins.length.toLocaleString()} pines · ${board.nets.length.toLocaleString()} redes`;
    document.title = `${board.fileName} — Boardview KK67`;
    toast(`${board.fileName} cargado (${board.format})`, 'ok', 2200);
    this.invalidate();
  }

  private async openPdf(name: string, data: Uint8Array): Promise<void> {
    try {
      this.togglePdf(true);
      await this.pdf.open(name, data);
      this.inspector.render();
    } catch (e) {
      toast(`No se pudo abrir el PDF: ${(e as Error).message}`, 'error');
    }
  }

  /* ================================================================== */
  /* State reactions                                                     */
  /* ================================================================== */

  private onState(s: typeof this.store.state, changed: Set<string>): void {
    if (changed.has('selection')) {
      this.inspector.setSelection(s.selection);
      this.sidebar.setActive(s.selection);
      if (s.settings.autoPdfSearch && this.pdf.loaded && s.selection && s.board) {
        const sel = s.selection;
        const text = sel.kind === 'part' ? s.board.parts[sel.id].name : sel.kind === 'net' ? s.board.nets[sel.id].name : null;
        if (text) this.searchPdf(text, false);
      }
    }
    if (changed.has('side')) {
      for (const [k, el] of Object.entries(this.sideButtons)) el.classList.toggle('on', k === s.side);
      this.status.side.textContent = s.side === 'top' ? 'Cara superior' : s.side === 'bottom' ? 'Cara inferior' : 'Ambas caras';
    }
    if (changed.has('settings')) {
      saveSettings(s.settings);
      this.applyTheme();
      this.inspector.render();
    }
    if (changed.has('measuring')) {
      this.measureBtn.classList.toggle('on', s.measuring);
      this.stage.classList.toggle('measuring', s.measuring);
      this.status.mode.textContent = s.measuring ? 'MEDICIÓN' : '';
      this.status.mode.classList.toggle('on', s.measuring);
    }
    this.invalidate();
  }

  private applyTheme(): void {
    const t = this.store.state.settings.theme;
    document.documentElement.dataset.theme = t === 'paper' ? 'light' : 'dark';
    document.documentElement.dataset.palette = t;
    if (this.renderer) this.renderer.palette = PALETTES[t];
    this.invalidate();
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.store.set({ settings: { ...this.store.state.settings, ...patch } });
  }

  private openSettings(): void {
    openSettings(this.store.state.settings, (p) => this.updateSettings(p), {
      exportNotes: () => {
        const b = this.store.state.board;
        download(`${b?.fileName ?? 'board'}.notas.json`, this.notes.exportJSON(), 'application/json');
      },
      importNotes: (json) => {
        try {
          if (!this.store.state.board) throw new Error('Abre primero una placa');
          toast(`${this.notes.importJSON(json)} notas importadas`, 'ok');
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      },
    });
  }

  private refreshAnnotations(): void {
    const b = this.store.state.board;
    this.annotatedPins.clear();
    this.annotationLabels.clear();
    if (!b) return;
    const byKey = new Map(this.notes.all().filter((a) => a.key.startsWith('pin:')).map((a) => [a.key, a]));
    if (byKey.size) {
      for (const pin of b.pins) {
        const a = byKey.get(annotationKey(b, 'pin', pin.id));
        if (!a) continue;
        this.annotatedPins.add(pin.id);
        const label = [a.diode && `D${a.diode}`, a.voltage && `${a.voltage}V`, a.resistance && `${a.resistance}Ω`].filter(Boolean).join(' ');
        if (label) this.annotationLabels.set(pin.id, label);
      }
    }
    this.invalidate();
  }

  /* ================================================================== */
  /* Selection & navigation                                              */
  /* ================================================================== */

  select(sel: Selection, opts: { additive?: boolean; focus?: boolean } = {}): void {
    const b = this.store.state.board;
    if (!b) return;
    if (opts.additive && sel) {
      const net = sel.kind === 'net' ? sel.id : sel.kind === 'pin' ? b.pins[sel.id].net : -1;
      if (net >= 0) return this.togglePinned(net);
    }
    // Bring the item's side into view automatically.
    if (sel && opts.focus) {
      const side = sel.kind === 'part' ? b.parts[sel.id].side : sel.kind === 'pin' ? b.pins[sel.id].side : null;
      if (side && !isVisible(side, this.store.state.side)) this.setSide(side === 'bottom' ? 'bottom' : 'top');
    }
    this.store.set({ selection: sel });
    if (sel && opts.focus) this.focusOn(sel);
  }

  private togglePinned(net: number): void {
    const cur = this.store.state.pinnedNets;
    const next = cur.includes(net) ? cur.filter((n) => n !== net) : [...cur, net].slice(-5);
    this.store.set({ pinnedNets: next });
    this.inspector.render();
    const b = this.store.state.board!;
    toast(cur.includes(net) ? `Red ${b.nets[net].name} desfijada` : `Red ${b.nets[net].name} fijada para comparar`, 'info', 1600);
  }

  private focusOn(sel: Exclude<Selection, null>): void {
    const b = this.store.state.board!;
    let box: Bounds;
    if (sel.kind === 'pin') {
      const p = b.pins[sel.id];
      const part = b.parts[p.part];
      const span = Math.max(p.r * 18, part ? Math.min(Math.max(part.rect.w, part.rect.h) * 0.6, p.r * 60) : 0);
      box = { minX: p.x - span, maxX: p.x + span, minY: p.y - span, maxY: p.y + span };
      this.cam.fit(box, 40);
      this.cam.flyTo(p.x, p.y, this.cam.targetScale);
    } else {
      const pts: Pt[] = sel.kind === 'part'
        ? rectCorners(b.parts[sel.id].rect)
        : [...b.nets[sel.id].pins.map((i) => b.pins[i]), ...b.nets[sel.id].nails.map((i) => b.nails[i])];
      if (!pts.length) return;
      box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const p of pts) {
        box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x);
        box.minY = Math.min(box.minY, p.y); box.maxY = Math.max(box.maxY, p.y);
      }
      const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.6 + 120;
      box.minX -= pad; box.maxX += pad; box.minY -= pad; box.maxY += pad;
      this.cam.fit(box, 40);
    }
    this.invalidate();
  }

  private onSearchHit(hit: SearchHit, additive: boolean): void {
    this.select({ kind: hit.kind, id: hit.id }, { additive, focus: true });
  }

  private selectNoteKey(key: string): void {
    const b = this.store.state.board;
    if (!b || !this.index) return;
    const [kind, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (kind === 'part') {
      const id = this.index.partByName(name);
      if (id >= 0) this.select({ kind: 'part', id }, { focus: true });
    } else if (kind === 'net') {
      const id = this.index.netByName(name);
      if (id >= 0) this.select({ kind: 'net', id }, { focus: true });
    } else {
      const dot = name.lastIndexOf('.');
      const part = this.index.partByName(name.slice(0, dot));
      const pin = part >= 0 ? b.parts[part].pins.find((p) => b.pins[p].num === name.slice(dot + 1)) : undefined;
      if (pin !== undefined) this.select({ kind: 'pin', id: pin }, { focus: true });
    }
  }

  /** Text selected in the schematic → matching part (preferred) or net on the board. */
  private onPdfToken(text: string): void {
    if (!this.index) return;
    const t = text.replace(/[\s,;:()]+$/g, '').trim();
    const part = this.index.partByName(t);
    if (part >= 0) return this.select({ kind: 'part', id: part }, { focus: true });
    const net = this.index.netByName(t);
    if (net >= 0) return this.select({ kind: 'net', id: net }, { focus: true });
    toast(`"${t}" no existe en la placa`, 'info', 1800);
  }

  private searchPdf(text: string, explicit: boolean): void {
    if (!this.pdf.loaded) {
      if (explicit) toast('Carga primero un esquema PDF (o un ZIP que lo contenga)', 'info');
      return;
    }
    this.togglePdf(true);
    void this.pdf.search(text, { quiet: !explicit });
  }

  private togglePdf(force?: boolean): void {
    const show = force ?? this.root.classList.contains('no-pdf');
    if (show && !this.pdf.loaded && force === undefined) {
      // No PDF yet: offer to open one.
      const input = h('input', { type: 'file', accept: '.pdf,application/pdf' }) as HTMLInputElement;
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (f) await this.openPdf(f.name, new Uint8Array(await f.arrayBuffer()));
      });
      input.click();
      return;
    }
    // Give the board room on narrower screens: tuck the lists away while the schematic is open.
    if (show && this.root.classList.contains('no-pdf') && window.innerWidth < 1800) this.togglePanel('sidebar', false);
    this.root.classList.toggle('no-pdf', !show);
    this.pdfToggle.classList.toggle('on', show);
    requestAnimationFrame(() => this.resize());
  }

  /* ================================================================== */
  /* View controls                                                       */
  /* ================================================================== */

  togglePanel(which: 'sidebar' | 'inspector', show?: boolean): void {
    const cls = which === 'sidebar' ? 'no-sidebar' : 'no-inspector';
    const visible = show ?? this.root.classList.contains(cls);
    this.root.classList.toggle(cls, !visible);
    (which === 'sidebar' ? this.sidebarBtn : this.inspectorBtn).classList.toggle('on', visible);
    requestAnimationFrame(() => this.resize());
  }

  setSide(side: ViewSide): void {
    if (side === this.store.state.side) return;
    // Flip mirrors around the current centre so the same area stays on screen.
    this.cam.mirror = side === 'bottom';
    this.mirrorBtn.classList.toggle('on', this.cam.mirror);
    this.hideTooltip();
    this.store.set({ side, hover: null });
  }

  private toggleMirror(): void {
    this.cam.mirror = !this.cam.mirror;
    this.mirrorBtn.classList.toggle('on', this.cam.mirror);
    this.invalidate();
  }

  private rotate(dir: number): void {
    this.cam.rotation = (this.cam.rotation + dir + 4) % 4;
    this.invalidate();
  }

  private fit(): void {
    const b = this.store.state.board;
    if (b) this.cam.fit(b.bounds, 48);
    this.invalidate();
  }

  private zoomCenter(f: number): void {
    this.cam.zoomAt(this.cam.width / 2, this.cam.height / 2, f);
    this.invalidate();
  }

  private toggleMeasure(): void {
    const on = !this.store.state.measuring;
    if (!on) this.measure = null;
    this.store.set({ measuring: on });
  }

  private screenshot(): void {
    if (!this.store.state.board) return;
    this.draw();
    this.canvas.toBlob((blob) => {
      if (blob) download(`${this.store.state.board!.fileName.replace(/\.[^.]+$/, '')}-${this.store.state.side}.png`, blob);
    }, 'image/png');
  }

  /* ================================================================== */
  /* Input                                                               */
  /* ================================================================== */

  private bindStage(): void {
    const c = this.canvas;
    const pointers = new Map<number, Pt>();
    let downAt: Pt | null = null;
    let moved = false;
    let pinchDist = 0;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      downAt = p;
      moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.updateCursor(p);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        this.updateHover(p, e);
        return;
      }
      if (pointers.size === 2) {
        pointers.set(e.pointerId, p);
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchDist > 0) this.cam.zoomAt(mid.x, mid.y, d / pinchDist);
        this.cam.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
        pinchDist = d;
        moved = true;
        this.invalidate();
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 3) moved = true;
      if (moved) {
        this.dragging = true;
        this.cam.panBy(p.x - prev.x, p.y - prev.y);
        this.hideTooltip();
        this.stage.classList.add('panning');
        this.invalidate();
      }
      pointers.set(e.pointerId, p);
    });

    const up = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      this.stage.classList.remove('panning');
      if (this.dragging) {
        this.dragging = false;
        this.invalidate();
      }
      if (!moved && wasSingle && e.type === 'pointerup') this.onClick(local(e), e);
      downAt = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      this.hideTooltip();
      if (this.store.state.hover) this.store.set({ hover: null });
    });

    c.addEventListener('dblclick', (e) => {
      const hit = this.renderer.hitTest(this.cam, ...xy(local(e)), this.store.state.side);
      if (hit) this.focusOn(hit.kind === 'pin' ? { kind: 'pin', id: hit.id } : { kind: 'part', id: hit.id });
      else {
        const p = local(e);
        this.cam.zoomAt(p.x, p.y, 2);
        this.invalidate();
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const isTrackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5 && Math.abs(e.deltaX) >= Math.abs(e.deltaY) * 0.3;
      if (isTrackpadPan) {
        this.cam.panBy(-e.deltaX, -e.deltaY);
      } else {
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
        const dy = e.deltaY * unit;
        const factor = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022));
        this.cam.zoomAt(p.x, p.y, factor);
      }
      this.hideTooltip();
      this.invalidate();
    }, { passive: false });
  }

  private onClick(p: Pt, e: PointerEvent): void {
    const s = this.store.state;
    if (!s.board) return;
    if (s.measuring) {
      const w = this.snapPoint(p);
      if (!this.measure || this.measure.b) this.measure = { a: w, b: null };
      else this.measure.b = w;
      this.invalidate();
      return;
    }
    const hit = this.renderer.hitTest(this.cam, p.x, p.y, s.side);
    if (!hit) {
      if (!e.shiftKey) this.store.set({ selection: null });
      return;
    }
    this.select(hit.kind === 'pin' ? { kind: 'pin', id: hit.id } : { kind: 'part', id: hit.id }, { additive: e.shiftKey });
  }

  /** Measurement snaps to pad centres when the cursor is on one. */
  private snapPoint(p: Pt): Pt {
    const hit = this.renderer.hitTest(this.cam, p.x, p.y, this.store.state.side);
    if (hit?.kind === 'pin') {
      const pin = this.store.state.board!.pins[hit.id];
      return { x: pin.x, y: pin.y };
    }
    return this.cam.toWorld(p.x, p.y);
  }

  private updateCursor(p: Pt): void {
    const w = this.cam.toWorld(p.x, p.y);
    const mm = this.store.state.settings.units === 'mm';
    this.status.coords.textContent = mm ? `X ${(w.x * 0.0254).toFixed(2)}  Y ${(w.y * 0.0254).toFixed(2)} mm` : `X ${w.x.toFixed(0)}  Y ${w.y.toFixed(0)} mil`;
    if (this.store.state.measuring && this.measure && !this.measure.b) {
      this.measurePreview = this.snapPoint(p);
      this.invalidate();
    }
  }

  private measurePreview: Pt | null = null;
  private hoverRaf = 0;

  private updateHover(p: Pt, e: PointerEvent): void {
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const s = this.store.state;
      if (!s.board) return;
      const hit = this.renderer.hitTest(this.cam, p.x, p.y, s.side);
      const cur = s.hover;
      if (hit?.kind !== cur?.kind || hit?.id !== cur?.id) this.store.set({ hover: hit });
      this.showTooltip(hit, e);
    });
  }

  private showTooltip(hit: HitResult | null, e: PointerEvent): void {
    const b = this.store.state.board;
    if (!hit || !b) return this.hideTooltip();
    let html: string;
    if (hit.kind === 'pin') {
      const pin = b.pins[hit.id];
      const net = b.nets[pin.net];
      const note = this.annotationLabels.get(hit.id);
      html = `<b>${esc(b.parts[pin.part]?.name ?? '?')}<span class="tt-dim">.</span>${esc(pin.num)}</b><span class="tt-net"><i class="dot ${net.kind}"></i>${esc(net.name)}</span><span class="tt-dim">${net.pins.length} pines en red</span>${note ? `<span class="tt-note">${esc(note)}</span>` : ''}`;
    } else {
      const part = b.parts[hit.id];
      html = `<b>${esc(part.name)}</b>${part.mfg ? `<span class="tt-dim">${esc(part.mfg)}</span>` : ''}<span class="tt-dim">${part.pins.length} pines · ${part.side === 'top' ? 'Top' : part.side === 'bottom' ? 'Bottom' : 'TH'}</span>`;
    }
    this.tooltip.innerHTML = html;
    const r = this.stage.getBoundingClientRect();
    let x = e.clientX - r.left + 16;
    let y = e.clientY - r.top + 18;
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    if (x + tw > r.width - 8) x = e.clientX - r.left - tw - 12;
    if (y + th > r.height - 8) y = e.clientY - r.top - th - 12;
    this.tooltip.style.transform = `translate(${x}px, ${y}px)`;
    this.tooltip.classList.add('on');
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('on');
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && (k === 'k' || k === 'f')) { e.preventDefault(); this.palette.open(); return; }
      if (mod && k === 'o') { e.preventDefault(); this.fileInput.click(); return; }
      if (mod) return;
      this.hideTooltip();
      const pan = 120;
      switch (k) {
        case '/': e.preventDefault(); this.palette.open(); break;
        case ' ': e.preventDefault(); this.setSide(this.store.state.side === 'top' ? 'bottom' : 'top'); break;
        case 'b': case 'B': this.setSide(this.store.state.side === 'both' ? 'top' : 'both'); break;
        case 'r': this.rotate(1); break;
        case 'R': this.rotate(-1); break;
        case 'x': case 'X': this.toggleMirror(); break;
        case 'f': this.fit(); break;
        case 'F': { const sel = this.store.state.selection; if (sel) this.focusOn(sel); break; }
        case 'm': case 'M': this.toggleMeasure(); break;
        case 'p': case 'P': this.togglePdf(); break;
        case '?': openShortcuts(); break;
        case '[': this.togglePanel('sidebar'); break;
        case ']': this.togglePanel('inspector'); break;
        case '+': case '=': this.zoomCenter(1.4); break;
        case '-': case '_': this.zoomCenter(1 / 1.4); break;
        case 'ArrowLeft': this.cam.panBy(pan, 0, false); this.invalidate(); break;
        case 'ArrowRight': this.cam.panBy(-pan, 0, false); this.invalidate(); break;
        case 'ArrowUp': this.cam.panBy(0, pan, false); this.invalidate(); break;
        case 'ArrowDown': this.cam.panBy(0, -pan, false); this.invalidate(); break;
        case 'Escape':
          if (this.store.state.measuring) this.toggleMeasure();
          else this.store.set({ selection: null, pinnedNets: [] });
          break;
        default: return;
      }
    });
  }

  private bindDrop(): void {
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      this.dropzone.classList.add('on');
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.dropzone.classList.remove('on');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      this.dropzone.classList.remove('on');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.openFiles(files);
    });
  }

  /* ================================================================== */
  /* Frame loop                                                          */
  /* ================================================================== */

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cam.width = r.width;
    this.cam.height = r.height;
    this.renderer.resize(r.width, r.height, dpr);
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  private frame(t: number): void {
    const dt = Math.min(64, t - this.lastFrame);
    this.lastFrame = t;
    const moving = this.cam.step(dt);
    if (moving || this.dirty) {
      this.dirty = false;
      this.draw(moving || this.dragging);
      // One crisp full-quality frame once motion settles.
      if (moving) this.settleFrame = true;
    } else if (this.settleFrame) {
      this.settleFrame = false;
      this.draw(false);
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  private settleFrame = false;
  private dragging = false;

  private draw(fast = false): void {
    const s = this.store.state;
    const measure = this.measure && !this.measure.b && this.measurePreview ? { a: this.measure.a, b: this.measurePreview } : this.measure;
    this.renderer.draw(this.cam, s.side, s.selection, s.pinnedNets, s.settings, {
      annotatedPins: this.annotatedPins,
      annotationLabel: (id) => this.annotationLabels.get(id) ?? null,
      measure,
      hover: s.hover,
    }, fast);
    this.minimap.draw(s.board, this.cam, this.renderer.palette, s.side);
    const pct = this.cam.scale * 1000; // px per inch
    this.status.zoom.textContent = `${pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)} px/in`;
  }
}

const xy = (p: Pt): [number, number] => [p.x, p.y];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Brand mark: stylised BGA die with a highlighted trace. */
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="kkg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e1ff"/><stop offset="1" stop-color="#ff6ec7"/></linearGradient></defs><rect x="3" y="3" width="26" height="26" rx="7" fill="none" stroke="url(#kkg)" stroke-width="2"/><g fill="currentColor" opacity=".55"><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/><circle cx="22" cy="10" r="1.6"/><circle cx="10" cy="16" r="1.6"/><circle cx="22" cy="16" r="1.6"/><circle cx="10" cy="22" r="1.6"/><circle cx="16" cy="22" r="1.6"/></g><path d="M16 16 22 22" stroke="url(#kkg)" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="2.4" fill="#22e1ff"/><circle cx="22" cy="22" r="2.4" fill="#ff6ec7"/></svg>`;
