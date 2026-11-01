// SPDX-License-Identifier: MIT
// What every window outside the main one shares: it follows the settings saved in the main window
// (theme, appearance, motion, language) and paints on a transparent background.
import { useEffect } from 'react';
import { changeLanguage } from '../i18n';
import { api } from '../ipc';
import { useApp } from '../state/store';
import { applyTheme, getTheme, modeFor } from '../theme/registry';

export function reducedMotion(): boolean {
  const setting = useApp.getState().settings?.reducedMotion ?? 'system';
  return setting === 'on' || (setting === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function useSurface() {
  const settings = useApp((state) => state.settings);

  useEffect(() => {
    if (!settings) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      applyTheme(document.documentElement, getTheme(settings.theme), modeFor(settings.appearance, dark.matches));
      document.documentElement.classList.toggle('reduce-motion', reducedMotion());
    };
    apply();
    dark.addEventListener('change', apply);
    return () => dark.removeEventListener('change', apply);
  }, [settings]);

  useEffect(() => {
    const stop = api.onSettings((saved) => {
      useApp.setState({ settings: saved.settings, language: saved.language });
      void changeLanguage(saved.language);
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);
}
