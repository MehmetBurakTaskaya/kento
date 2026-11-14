// SPDX-License-Identifier: MIT
// The Themes page (SPEC 5.20), opened from the theme in the rail and from Settings › Appearance:
// the chosen theme's wheel to try and every theme as a card. It is a page of its own so that
// Settings stays light to scroll.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../state/store';
import { ThemePicker } from './ThemePicker';

export function Themes() {
  const { t } = useTranslation();
  const { settings, update } = useApp();
  const heading = useId();
  if (!settings) return null;
  return (
    <div className="page">
      <header className="page-head">
        <h1 id={heading} className="page-title">
          {t('nav.themes')}
        </h1>
      </header>
      <ThemePicker settings={settings} labelledBy={heading} onChange={(theme) => void update({ theme })} />
    </div>
  );
}
