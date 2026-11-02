// SPDX-License-Identifier: MIT
// The main window: a navigation rail (Home, Library, Settings) and the open page. It follows the
// appearance and motion settings, listens to the core's events and shows the window once painted.
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/Icon';
import { Toasts } from '../components/Toasts';
import { api, type Section } from '../ipc';
import { useApp, type PanelTool } from '../state/store';
import { applyTheme, getTheme, modeFor } from '../theme/registry';
import { ToolPanel } from '../tools/ToolPanel';
import { WebDialog } from '../web/WebDialog';
import { WheelDemo, wheelDemoRequested } from '../wheel';
import { Home } from './Home';
import { useFileInput } from './input';
import { Library } from './Library';
import { Settings } from './Settings';
import { Setup } from './Setup';
import { WheelHost } from './WheelHost';

const NAV: { section: Section; icon: IconName; key: string; shortcut: string }[] = [
  { section: 'home', icon: 'home', key: 'nav.home', shortcut: '1' },
  { section: 'library', icon: 'library', key: 'nav.library', shortcut: '2' },
  { section: 'settings', icon: 'settings', key: 'nav.settings', shortcut: ',' },
];

export function App() {
  const { t } = useTranslation();
  const { boot, settings, section, setSection, jobChanged, setPaused, refreshLibrary } = useApp();
  useFileInput(boot?.app.platform === 'macos');

  // Theme and motion follow the settings and the system.
  useEffect(() => {
    if (!settings) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      applyTheme(document.documentElement, getTheme(settings.theme), modeFor(settings.appearance, dark.matches));
      const reduce = settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && motion.matches);
      document.documentElement.classList.toggle('reduce-motion', reduce);
    };
    apply();
    dark.addEventListener('change', apply);
    motion.addEventListener('change', apply);
    return () => {
      dark.removeEventListener('change', apply);
      motion.removeEventListener('change', apply);
    };
  }, [settings]);

  // Events from the core.
  useEffect(() => {
    const stops = [
      api.onJob(jobChanged),
      api.onPaused(setPaused),
      api.onNavigate(setSection),
      api.onLibrary(() => void refreshLibrary()),
    ];
    void refreshLibrary();
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, [jobChanged, setPaused, setSection, refreshLibrary]);

  // A tool chosen on the floating wheel opens its panel here.
  useEffect(() => {
    const open = (tool: string, paths: string[]) => {
      if (tool === 'setup') return useApp.getState().openSetup();
      void useApp
        .getState()
        .addFiles(paths)
        .then((entries) =>
          useApp.getState().openPanel(
            tool as PanelTool,
            entries.map((entry) => entry.path),
          ),
        );
    };
    void api.takePendingTool().then((pending) => pending && open(...pending));
    const stops = [api.onOpenTool(open), api.onOpenSetup(() => useApp.getState().openSetup())];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  // The download dialog for a link from the floating wheel's More… or the download shortcut. A
  // quick download from the wheel shows the first-use notice itself, so the dialog no longer does.
  useEffect(() => {
    const take = () => void api.webTakePending().then((url) => url && useApp.getState().openWeb(url));
    take();
    const stops = [
      api.onWebOpen(take),
      api.onSettings((saved) => {
        const { settings } = useApp.getState();
        if (settings && saved.settings.web.noticeShown && !settings.web.noticeShown) {
          useApp.setState({ settings: { ...settings, web: { ...settings.web, noticeShown: true } } });
        }
      }),
    ];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  // Ctrl+1, Ctrl+2 and Ctrl+, (⌘ on macOS) switch pages.
  useEffect(() => {
    const mac = boot?.app.platform === 'macos';
    const onKey = (event: KeyboardEvent) => {
      if ((mac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey) {
        const target = NAV.find((item) => item.shortcut === event.key);
        if (target) {
          event.preventDefault();
          setSection(target.section);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boot, setSection]);

  // The window appears once the first page has painted (a hidden smoke-test window stays hidden).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('hidden')) return;
    requestAnimationFrame(() => requestAnimationFrame(() => void api.uiReady()));
  }, []);

  const mac = boot?.app.platform === 'macos';
  return (
    <div className="shell">
      <nav className="rail" aria-label={t('nav.main')}>
        {NAV.map((item) => (
          <button
            key={item.section}
            type="button"
            className="rail-item"
            aria-current={section === item.section ? 'page' : undefined}
            aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+${item.shortcut}`}
            onClick={() => setSection(item.section)}
          >
            <Icon name={item.icon} size={22} />
            <span>{t(item.key)}</span>
          </button>
        ))}
      </nav>
      <main className="content">
        {wheelDemoRequested() ? (
          <Suspense fallback={null}>
            <WheelDemo />
          </Suspense>
        ) : (
          <>
            {section === 'home' && <Home />}
            {section === 'library' && <Library />}
            {section === 'settings' && <Settings />}
          </>
        )}
      </main>
      <WheelHost />
      <ToolPanel />
      <WebDialog />
      <Setup />
      <Toasts />
    </div>
  );
}
