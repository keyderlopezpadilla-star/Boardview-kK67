/** Renders app icons (PWA, Electron, Android) from the brand mark. node scripts/make-icons.cjs */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e1ff"/><stop offset="1" stop-color="#ff6ec7"/></linearGradient><radialGradient id="r" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="#16202c"/><stop offset="1" stop-color="#07090c"/></radialGradient></defs><rect width="32" height="32" rx="${pad ? 0 : 7}" fill="url(#r)"/><g transform="translate(16 16) scale(${pad ? 0.62 : 0.86}) translate(-16 -16)"><rect x="4" y="4" width="24" height="24" rx="6" fill="none" stroke="url(#g)" stroke-width="2"/><g fill="#8aa0b8"><circle cx="11" cy="11" r="1.6"/><circle cx="16" cy="11" r="1.6"/><circle cx="21" cy="11" r="1.6"/><circle cx="11" cy="16" r="1.6"/><circle cx="21" cy="16" r="1.6"/><circle cx="11" cy="21" r="1.6"/><circle cx="16" cy="21" r="1.6"/></g><path d="M16 16 21 21" stroke="url(#g)" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="2.4" fill="#22e1ff"/><circle cx="21" cy="21" r="2.4" fill="#ff6ec7"/></g></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (svg, size, out) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out, omitBackground: true });
  };
  await shot(mark(false), 192, path.join(root, 'public/icons/icon-192.png'));
  await shot(mark(false), 512, path.join(root, 'public/icons/icon-512.png'));
  await shot(mark(true), 512, path.join(root, 'public/icons/maskable-512.png'));
  await shot(mark(false), 512, path.join(root, 'build/icon.png'));
  await shot(mark(true), 1024, path.join(root, 'build/icon-android.png'));
  await b.close();
  console.log('icons ok');
})();
