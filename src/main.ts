import './styles.css';
import { App } from './app';

new App().boot().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'Failed to start: ' + (err instanceof Error ? err.message : String(err));
});
