import type { PartInfo } from '../core/catalog';
import { escapeHtml } from './dom';

/**
 * Original, scale-free SVG illustrations of package families (isometric-ish
 * 3/4 view). Marking text uses the real value / part number of the selected
 * component so the picture matches what the technician should find on the board.
 */

const W = 220;
const H = 140;

function shell(inner: string, label: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(label)}">
<defs>
  <linearGradient id="pa-tin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f4"/><stop offset=".55" stop-color="#b9bfc6"/><stop offset="1" stop-color="#8d949c"/></linearGradient>
  <linearGradient id="pa-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d27a"/><stop offset="1" stop-color="#b8892c"/></linearGradient>
  <linearGradient id="pa-black" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34373c"/><stop offset="1" stop-color="#121315"/></linearGradient>
  <linearGradient id="pa-cer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6ab78"/><stop offset="1" stop-color="#94683e"/></linearGradient>
  <linearGradient id="pa-grey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d636b"/><stop offset="1" stop-color="#2c3036"/></linearGradient>
  <linearGradient id="pa-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#c3c9cf"/><stop offset="1" stop-color="#8e969e"/></linearGradient>
  <linearGradient id="pa-sub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f6638"/><stop offset="1" stop-color="#2e3d20"/></linearGradient>
  <linearGradient id="pa-beige" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3ecdc"/><stop offset="1" stop-color="#c9bea4"/></linearGradient>
  <radialGradient id="pa-shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" rx="12" fill="#0c4a2b"/>
<ellipse cx="${W / 2}" cy="${H * 0.72}" rx="${W * 0.36}" ry="${H * 0.12}" fill="url(#pa-shadow)"/>
${inner}
</svg>`;
}

/** Cuboid with top face, front face and right face. */
function box(x: number, y: number, w: number, d: number, h: number, top: string, front: string, side: string): string {
  const dx = d * 0.55, dy = d * 0.45;
  return `<path d="M${x} ${y + dy} l${dx} ${-dy} h${w} l${-dx} ${dy} z" fill="${top}"/>
<path d="M${x} ${y + dy} h${w} v${h} h${-w} z" fill="${front}"/>
<path d="M${x + w} ${y + dy} l${dx} ${-dy} v${h} l${-dx} ${dy} z" fill="${side}"/>`;
}

function text(x: number, y: number, s: string, size: number, fill = '#e8e8e8', weight = 600): string {
  const t = escapeHtml(s.length > 16 ? s.slice(0, 15) + '…' : s);
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="${size}" font-weight="${weight}" fill="${fill}">${t}</text>`;
}

export function partIllustration(info: PartInfo, pinCount: number): string {
  const mark = info.value ?? info.mpn ?? '';
  const label = `${info.category} ${info.pkg ?? ''}`.trim();
  switch (info.body) {
    case 'chip-cap':
    case 'chip-res':
    case 'chip-ind': {
      const res = info.body !== 'chip-cap';
      const body = res ? 'url(#pa-black)' : 'url(#pa-cer)';
      return shell(
        box(64, 52, 92, 34, 26, res ? '#2a2c30' : '#c99c68', body, res ? '#0e0f10' : '#7d5733') +
          box(44, 52, 22, 34, 26, '#f0f2f4', 'url(#pa-tin)', '#7f868d') +
          box(154, 52, 22, 34, 26, '#f0f2f4', 'url(#pa-tin)', '#7f868d') +
          (res && mark ? text(118, 70, smdCode(mark), 11, '#f2f2f2') : ''),
        label,
      );
    }
    case 'sod':
      return shell(
        `<rect x="48" y="80" width="26" height="10" rx="2" fill="url(#pa-tin)"/><rect x="146" y="80" width="26" height="10" rx="2" fill="url(#pa-tin)"/>` +
          box(64, 50, 92, 30, 30, '#2b2d31', 'url(#pa-black)', '#0d0e0f') +
          `<rect x="70" y="58" width="10" height="14" fill="#b9c0c7" opacity=".85"/>`,
        label,
      );
    case 'polymer':
      return shell(
        box(52, 46, 116, 40, 36, '#2b2d31', 'url(#pa-black)', '#0b0c0d') +
          `<path d="M52 64 l22 -18 h22 l-22 18 z" fill="#aab3bc"/><rect x="52" y="64" width="22" height="36" fill="#8f99a3"/>` +
          text(124, 76, mark, 12, '#e6e6e6'),
        label,
      );
    case 'molded-ind':
      return shell(
        `<rect x="54" y="98" width="30" height="8" rx="2" fill="url(#pa-tin)"/><rect x="136" y="98" width="30" height="8" rx="2" fill="url(#pa-tin)"/>` +
          box(54, 30, 112, 46, 54, '#6a7079', 'url(#pa-grey)', '#24282d') +
          text(108, 80, mark.replace('µH', 'uH'), 14, '#e8e8e8'),
        label,
      );
    case 'crystal':
      return shell(
        box(50, 48, 120, 40, 22, '#e2e6ea', 'url(#pa-metal)', '#8a9199') +
          `<path d="M66 70 l14 -12 h80 l-14 12 z" fill="#f6f7f8" opacity=".8"/>` +
          text(106, 98, mark, 12, '#20262c'),
        label,
      );
    case 'connector': {
      const n = Math.min(Math.max(pinCount, 4), 18);
      let pins = '';
      for (let i = 0; i < n; i++) pins += `<rect x="${42 + i * (136 / n)}" y="96" width="${(136 / n) * 0.45}" height="10" fill="url(#pa-gold)"/>`;
      const light = /FPC|WTOB|BTOB|FFC/i.test(info.description ?? '');
      return shell(pins + box(36, 40, 140, 36, 46, light ? '#fbf6ea' : '#3a3c40', light ? 'url(#pa-beige)' : 'url(#pa-black)', light ? '#b5a888' : '#121315'), label);
    }
    case 'bga': {
      if (info.kind === 'cpu' || info.kind === 'gpu') {
        return shell(
          box(36, 40, 148, 52, 10, '#5a7442', 'url(#pa-sub)', '#25331a') +
            box(76, 46, 68, 26, 8, '#d7dce1', 'url(#pa-metal)', '#7d858d') +
            text(110, 102, info.mpn ?? '', 11, '#e8efe0'),
          label,
        );
      }
      let balls = '';
      for (let i = 0; i < 12; i++) balls += `<circle cx="${50 + i * 11}" cy="101" r="3.6" fill="url(#pa-tin)"/>`;
      return shell(balls + box(40, 42, 140, 46, 14, '#2c2e32', 'url(#pa-black)', '#0d0e0f') + `<circle cx="58" cy="58" r="3" fill="#6c7075"/>` + text(118, 72, info.mpn ?? '', 11), label);
    }
    case 'qfp':
    case 'qfn':
    case 'pdfn':
    case 'sot':
    case 'generic':
    default: {
      const gull = info.body === 'qfp' || info.body === 'sot';
      const n = info.body === 'sot' ? Math.min(Math.max(Math.ceil(pinCount / 2), 1), 3) : Math.min(Math.max(Math.ceil(pinCount / 4), 3), 10);
      let leads = '';
      const span = 110;
      for (let i = 0; i < n; i++) {
        const x = 62 + (span / n) * (i + 0.5) - 5;
        leads += gull
          ? `<path d="M${x} 92 v8 h10 v-8" fill="none" stroke="url(#pa-tin)" stroke-width="4"/>`
          : `<rect x="${x}" y="96" width="9" height="6" fill="url(#pa-tin)"/>`;
      }
      return shell(
        leads +
          box(54, 46, 112, 42, info.body === 'qfn' || info.body === 'pdfn' ? 18 : 22, '#2c2e32', 'url(#pa-black)', '#0d0e0f') +
          `<circle cx="70" cy="62" r="3" fill="#6c7075"/>` +
          text(116, 72, info.mpn ?? mark, 11),
        label,
      );
    }
  }
}

/** SMD resistor marking (3-digit EIA) from a value such as "4.7k Ω" or "0 Ω". */
export function smdCode(value: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*([kKM]?)/.exec(value);
  if (!m) return value;
  let ohms = parseFloat(m[1]) * (m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1);
  if (ohms === 0) return '000';
  if (ohms < 10) return m[1].replace('.', 'R');
  let exp = 0;
  while (ohms >= 100 && exp < 9) {
    ohms /= 10;
    exp++;
  }
  return `${Math.round(ohms)}${exp}`;
}
