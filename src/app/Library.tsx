// SPDX-License-Identifier: MIT
// Library: the last 50 exports. It fills up once jobs produce files (Phase 2).
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';

export function Library() {
  const { t } = useTranslation();
  const count = 0;
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('nav.library')}</h1>
        <span className="muted">{t('library.count', { count })}</span>
      </header>
      <section className="card empty">
        <Icon name="library" size={32} />
        <h2 className="card-title">{t('library.empty.title')}</h2>
        <p className="muted">{t('library.empty.text')}</p>
      </section>
    </div>
  );
}
