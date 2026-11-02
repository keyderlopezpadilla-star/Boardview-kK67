const { contextBridge, ipcRenderer } = require('electron');

/** Minimal, typed bridge: the renderer only receives file payloads. */
contextBridge.exposeInMainWorld('kk67', {
  platform: 'desktop',
  onOpenFiles(cb) {
    ipcRenderer.on('kk67:open-files', (_e, files) => cb(files.map((f) => ({ name: f.name, data: new Uint8Array(f.data) }))));
  },
});
