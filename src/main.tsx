// SPDX-License-Identifier: MIT
import '@fontsource-variable/ibm-plex-sans/wght.css';
import './styles/global.css';
import './styles/work.css';
import './theme/steel';
import { isTauri } from '@tauri-apps/api/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n } from './i18n';
import { api, type Section } from './ipc';
import { useApp } from './state/store';
import { applyTheme, getTheme, modeFor } from './theme/registry';

const SECTIONS: Section[] = ['home', 'library', 'settings'];

async function start() {
  const boot = await api.bootstrap();
  await initI18n(boot.language);
  const store = useApp.getState();
  store.setBoot(boot);
  const section = new URLSearchParams(window.location.search).get('section');
  if (section && (SECTIONS as string[]).includes(section)) store.setSection(section as Section);
  document.documentElement.dataset.platform = boot.app.platform;
  // Paint the first frame in the right theme; App keeps it in step afterwards.
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(document.documentElement, getTheme(boot.settings.theme), modeFor(boot.settings.appearance, dark));
  // Screenshots and browser previews: ?files=demo fills Home with sample files.
  if (!isTauri() && new URLSearchParams(window.location.search).get('files') === 'demo') {
    await store.addFiles(await api.pickFiles());
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

window.addEventListener(
  'error',
  (event) => void api.log('error', `${event.message} (${event.filename}:${event.lineno})`),
);
window.addEventListener('unhandledrejection', (event) => void api.log('error', String(event.reason)));

start().catch((error) => void api.log('error', `start failed: ${String(error)}`));
