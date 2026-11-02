/**
 * Boardview KK67 Pro — Electron shell (Windows .exe).
 *
 * The built web app (dist/) is served from a privileged `app://` scheme rather
 * than file:// so module workers, fetch() and pdf.js behave exactly as on the web.
 * Files passed on the command line (double-click on .brd/.cad/… once associated)
 * are read here and handed to the renderer.
 */
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const BOARD_EXT = /\.(brd|bdv|asc|bvr|bv|cad|gcd|gencad|cst|fz|pcb|zip|pdf)$/i;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let rendererReady = false;
const pending = [];

const filesFromArgv = (argv) => argv.slice(1).filter((a) => !a.startsWith('-') && BOARD_EXT.test(a));

async function sendFiles(paths) {
  if (!paths.length) return;
  if (!win || !rendererReady) {
    pending.push(...paths);
    return;
  }
  const files = [];
  for (const p of paths) {
    try {
      files.push({ name: path.basename(p), data: await fs.readFile(p) });
    } catch (e) {
      console.error('No se pudo leer', p, e);
    }
  }
  if (files.length) win.webContents.send('kk67:open-files', files);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07090c',
    title: 'Boardview KK67 Pro',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // External links open in the system browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.webContents.on('did-start-loading', () => (rendererReady = false));
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    const queued = pending.splice(0);
    void sendFiles(queued);
  });
  win.loadURL('app://kk67/index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    void sendFiles(filesFromArgv(argv));
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const target = path.normalize(path.join(DIST, rel));
      if (!target.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).toString());
    });
    Menu.setApplicationMenu(null);
    pending.push(...filesFromArgv(process.argv));
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
