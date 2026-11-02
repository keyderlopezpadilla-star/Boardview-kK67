import './styles.css';
import { App } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('#app no encontrado');
const app = new App(root);

// `?demo` opens the sample board directly (handy for demos and screenshots).
if (new URLSearchParams(location.search).has('demo')) void app.loadDemo();
