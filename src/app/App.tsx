// SPDX-License-Identifier: MIT
// The main window: a navigation rail (Home, Library, Automation, Settings) and the open page. It
// follows the appearance and motion settings, listens to the core's events and shows the window
// once painted.
import { Fragment, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Automation } from '../automation/Automation';
import { Icon, type IconName } from '../components/Icon';
import { Toasts } from '../components/Toasts';
import { api, type Section } from '../ipc';
import { useApp, type PanelTool } from '../state/store';
import { DEFAULT_THEME, modeFor, showTheme, themeEntry, useLook } from '../theme/registry';
import { ToolPanel } from '../tools/ToolPanel';
import { WebDialog } from '../web/WebDialog';
import { WheelDemo, wheelDemoRequested } from '../wheel';
import { Home } from './Home';
import { useFileInput } from './input';
import { Library } from './Library';
import { Settings } from './Settings';
import { Setup } from './Setup';
import { ThemeThumb } from './ThemePicker';
import { isUpdateShortcut } from './UpdateSettings';
import { WheelHost } from './WheelHost';

const NAV: { section: Section; icon: IconName; key: string; shortcut: string }[] = [
  { section: 'home', icon: 'home', key: 'nav.home', shortcut: '1' },
  { section: 'library', icon: 'library', key: 'nav.library', shortcut: '2' },
  { section: 'automation', icon: 'automation', key: 'nav.automation', shortcut: '3' },
  { section: 'settings', icon: 'settings', key: 'nav.settings', shortcut: ',' },
];

/** The theme in use, at the foot of the rail: its wheel, small, and its name. It opens the theme picker. */
function ThemeBadge() {
  const { t } = useTranslation();
  const { settings, showThemes } = useApp();
  const id = settings?.theme ?? DEFAULT_THEME;
  const { mode } = useLook(id, settings?.appearance ?? 'system');
  const name = themeEntry(id).name;
  const label = t('nav.theme', { name });
  return (
    <button type="button" className="rail-item rail-theme" title={label} aria-label={label} onClick={showThemes}>
      <span className="rail-theme-thumb" aria-hidden="true">
        <ThemeThumb id={id} mode={mode} />
      </span>
      <span>{name}</span>
    </button>
  );
}

export function App() {
  const { t } = useTranslation();
  const { boot, settings, section, setSection, showUpdates, jobChanged, setPaused, refreshLibrary } = useApp();
  useFileInput(boot?.app.platform === 'macos');

  // Theme and motion follow the settings and the system.
  useEffect(() => {
    if (!settings) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      void showTheme(document.documentElement, settings.theme, modeFor(settings.appearance, dark.matches));
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
      api.onNavigate((next) => (next === 'updates' ? showUpdates() : setSection(next))),
      api.onLibrary(() => void refreshLibrary()),
      // A folder rule's failure, while this window has the focus (else it is the corner card).
      api.onAutomationFailed((failure) => useApp.getState().toast({ kind: 'failed', jobId: 0, ...failure })),
    ];
    void refreshLibrary();
    // The notes of a version installed just now, which the core hands out once.
    void api.updatesNews().then((news) => news && useApp.getState().setNews(news));
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, [jobChanged, setPaused, setSection, showUpdates, refreshLibrary]);

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
    // Make a QR code for a link dropped on the floating wheel's QR slice.
    const takeQr = () =>
      void api.qrTakePending().then((text) => text && useApp.getState().openPanel('make-qr', [], text));
    takeQr();
    const stops = [
      api.onWebOpen(take),
      api.onQrOpen(takeQr),
      api.onSettings((saved) => {
        const { settings } = useApp.getState();
        if (settings && saved.settings.web.noticeShown && !settings.web.noticeShown) {
          useApp.setState({ settings: { ...settings, web: { ...settings.web, noticeShown: true } } });
        }
      }),
    ];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  // Ctrl+1, Ctrl+2 and Ctrl+, (⌘ on macOS) switch pages; Ctrl+U looks for a new version and shows
  // Settings › Updates.
  useEffect(() => {
    const mac = boot?.app.platform === 'macos';
    const onKey = (event: KeyboardEvent) => {
      if (isUpdateShortcut(event, mac)) {
        event.preventDefault();
        void api.updatesCheck(false);
        showUpdates();
        return;
      }
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
  }, [boot, setSection, showUpdates]);

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
          <Fragment key={item.section}>
            {item.section === 'settings' && <ThemeBadge />}
            <button
              type="button"
              className="rail-item"
              aria-current={section === item.section ? 'page' : undefined}
              aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+${item.shortcut}`}
              onClick={() => setSection(item.section)}
            >
              <Icon name={item.icon} size={22} />
              <span>{t(item.key)}</span>
            </button>
          </Fragment>
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
            {section === 'automation' && <Automation />}
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
