import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { App } from './app';
import { registerServiceWorker } from './platform';

const root = document.getElementById('app');
if (!root) throw new Error('#app no encontrado');
const app = new App(root);

// `?demo` opens the sample board directly (handy for demos and screenshots).
if (new URLSearchParams(location.search).has('demo')) void app.loadDemo();

// Desktop: files double-clicked in Explorer / passed on the command line.
window.kk67?.onOpenFiles((files) => {
  void app.openFiles(files.map((f) => new File([f.data as BlobPart], f.name)));
});

registerServiceWorker();
