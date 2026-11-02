import type { Settings } from '../core/store';
import { checkFzKey, parseFzKey } from '../crypto/rc6';
import { checkXzzKey, parseDesKey } from '../crypto/des';
import { h, icon } from './dom';

/* ------------------------------ Toasts ------------------------------ */

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'ok' | 'error' = 'info', ms = 3600): void {
  if (!toastHost) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h(`div.toast.${kind}`, {}, message);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* ------------------------------ Modal base ------------------------------ */

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): { close: () => void; el: HTMLElement } {
  const close = () => {
    backdrop.classList.remove('in');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => backdrop.remove(), 180);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const dialog = h('div.modal' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', {}, h('h2', {}, title), h('button.icon-btn', { title: 'Cerrar', onclick: () => close() }, icon('close'))),
    h('div.modal-body', {}, body),
  );
  const backdrop = h('div.backdrop', { onmousedown: (e: Event) => e.target === backdrop && close() }, dialog);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => backdrop.classList.add('in'));
  return { close, el: dialog };
}

/* ------------------------------ Chooser ------------------------------ */

export function chooseFile(candidates: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    const list = h('div.choice-list', {},
      ...candidates.map((c) => h('button.choice', { onclick: () => { picked = c; m.close(); } }, icon('chip'), h('span', {}, c))),
    );
    const m = modal('Varios boardviews encontrados', h('div', {}, h('p.muted', {}, 'El archivo contiene más de una placa. Elige cuál abrir:'), list), {
      onClose: () => resolve(picked),
    });
  });
}

/* ------------------------------ Settings ------------------------------ */

export interface SettingsActions {
  exportNotes: () => void;
  importNotes: (json: string) => void;
}

export function openSettings(current: Settings, apply: (s: Partial<Settings>) => void, actions: SettingsActions): void {
  const s = { ...current };
  const toggle = (key: keyof Settings, label: string, hint: string) => {
    const input = h('input', { type: 'checkbox', checked: Boolean(s[key]) || undefined }) as HTMLInputElement;
    input.addEventListener('change', () => apply({ [key]: input.checked } as Partial<Settings>));
    return h('label.setting', {}, h('span.setting-text', {}, h('b', {}, label), h('small', {}, hint)), h('span.switch', {}, input, h('i')));
  };
  const select = <K extends keyof Settings>(key: K, label: string, options: [string, string][]) => {
    const sel = h('select.input', { onchange: (e: Event) => apply({ [key]: (e.target as HTMLSelectElement).value } as Partial<Settings>) },
      ...options.map(([v, t]) => h('option', { value: v, selected: s[key] === v || undefined }, t)),
    );
    return h('label.setting', {}, h('span.setting-text', {}, h('b', {}, label)), sel);
  };

  const fzStatus = h('small.key-status');
  const xzzStatus = h('small.key-status');
  const fz = h('textarea.input.mono', { rows: 5, placeholder: '0x........ 0x........ … (44 palabras de 32 bits)', spellcheck: 'false' }) as HTMLTextAreaElement;
  fz.value = s.fzKey;
  const xzz = h('input.input.mono', { placeholder: '16 dígitos hex', spellcheck: 'false' }) as HTMLInputElement;
  xzz.value = s.xzzKey;
  const validate = () => {
    const fk = parseFzKey(fz.value);
    fzStatus.textContent = !fz.value.trim() ? 'Sin clave' : checkFzKey(fk) ? '✓ Clave válida' : `✗ Inválida (${fk.length}/44 palabras o paridad incorrecta)`;
    fzStatus.className = 'key-status ' + (!fz.value.trim() ? '' : checkFzKey(fk) ? 'ok' : 'bad');
    const xk = parseDesKey(xzz.value);
    xzzStatus.textContent = !xzz.value.trim() ? 'Sin clave' : xk && checkXzzKey(xk) ? '✓ Clave válida' : '✗ Inválida';
    xzzStatus.className = 'key-status ' + (!xzz.value.trim() ? '' : xk && checkXzzKey(xk) ? 'ok' : 'bad');
  };
  fz.addEventListener('input', () => { validate(); apply({ fzKey: fz.value }); });
  xzz.addEventListener('input', () => { validate(); apply({ xzzKey: xzz.value }); });
  validate();

  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true }) as HTMLInputElement;
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (f) actions.importNotes(await f.text());
  });

  const body = h('div.settings', {},
    h('section', {}, h('h3', {}, 'Visualización'),
      select('theme', 'Tema', [['carbon', 'Carbon (oscuro)'], ['midnight', 'Midnight (azul)'], ['paper', 'Paper (claro / impresión)']]),
      select('units', 'Unidades', [['mil', 'mil (milésimas de pulgada)'], ['mm', 'milímetros']]),
      toggle('showRatsnest', 'Ratsnest', 'Líneas de conexión (MST) de la red seleccionada'),
      toggle('dimGround', 'Atenuar GND', 'Reduce el ruido visual de los planos de masa'),
      toggle('showPinLabels', 'Números de pin', 'Visibles al acercarse'),
      toggle('showNetLabels', 'Nombres de red en pines', 'Visibles con zoom alto'),
      toggle('autoPdfSearch', 'Enlace automático con esquema', 'Al seleccionar un componente o red, buscarlo en el PDF'),
    ),
    h('section', {}, h('h3', {}, 'Claves de formato'),
      h('p.muted', {}, 'Los formatos .fz (ASUS) y .pcb (XZZ) cifrados requieren la clave correspondiente. No se incluye ninguna con la aplicación; se guardan solo en este navegador.'),
      h('label.field', {}, h('span', {}, 'Clave FZ (RC6)'), fz, fzStatus),
      h('label.field', {}, h('span', {}, 'Clave XZZ (DES)'), xzz, xzzStatus),
    ),
    h('section', {}, h('h3', {}, 'Notas de diagnóstico'),
      h('p.muted', {}, 'Las mediciones (diodo, tensión, resistencia) se guardan por placa. Exporta para compartir con tu equipo o hacer backup.'),
      h('div.row', {},
        h('button.btn', { onclick: () => actions.exportNotes() }, icon('download'), 'Exportar JSON'),
        h('button.btn', { onclick: () => fileIn.click() }, icon('upload'), 'Importar JSON'),
        fileIn,
      ),
    ),
  );
  modal('Ajustes', body, { wide: true });
}

/* ------------------------------ Shortcuts ------------------------------ */

export function openShortcuts(): void {
  const rows: [string, string][] = [
    ['Ctrl/⌘ K  ·  /', 'Búsqueda global (componentes, redes, pines U1.A12)'],
    ['Ctrl/⌘ O', 'Abrir archivo'],
    ['Espacio', 'Cambiar cara superior / inferior'],
    ['B', 'Ver ambas caras'],
    ['R  ·  Shift R', 'Rotar 90° horario / antihorario'],
    ['X', 'Espejo horizontal'],
    ['F', 'Encuadrar placa  ·  Shift F encuadrar selección'],
    ['M', 'Herramienta de medición'],
    ['P', 'Mostrar / ocultar esquema PDF'],
    ['[  ·  ]', 'Ocultar / mostrar listas e inspector'],
    ['Shift + clic', 'Fijar red para comparar (multi-red)'],
    ['Doble clic', 'Zoom al componente / pin'],
    ['Esc', 'Limpiar selección'],
    ['+ / −  ·  rueda', 'Zoom anclado al cursor'],
    ['Flechas  ·  arrastrar', 'Desplazar'],
  ];
  modal('Atajos de teclado', h('div.shortcuts', {}, ...rows.map(([k, d]) => h('div.shortcut', {}, h('kbd', {}, k), h('span', {}, d)))));
}
