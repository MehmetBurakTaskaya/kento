// SPDX-License-Identifier: MIT
// Settings (SPEC 5.17).
import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import mark from '../../src-tauri/icons/128x128.png';
import { Icon } from '../components/Icon';
import { intlLocale, PSEUDO_LANGUAGES } from '../i18n';
import { formatBytes } from '../i18n/format';
import { api, type Settings as SettingsData, type ToolGroupStatus, type WheelKey } from '../ipc';
import { useApp } from '../state/store';
import { loadTheme, themeEntry } from '../theme/registry';
import { playFor } from '../wheel/voices';
import { LayoutSettings } from './LayoutSettings';
import { useToolStatus } from './Setup';
import { UpdateSettings } from './UpdateSettings';

/** A group of settings; `anchor` names it, so it can be brought into view. */
export function Group({ title, children, anchor }: { title: string; children: ReactNode; anchor?: string }) {
  const id = useId();
  return (
    <section className="card settings-group" aria-labelledby={id} id={anchor}>
      <h2 id={id} className="card-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="row">
      {htmlFor ? (
        <label className="row-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="row-label">{label}</span>
      )}
      <div className="row-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'is-on' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** Product names, the same in every language. */
const TOOL_NAMES: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  ffprobe: 'ffprobe',
  'yt-dlp': 'yt-dlp',
  deno: 'Deno',
  soffice: 'LibreOffice',
  exiftool: 'ExifTool',
  onnxruntime: 'ONNX Runtime',
  'bg-model': 'BEN2 Base',
};

/** Files Kento loads rather than programs it runs: only its own pinned downloads are used, so no
 *  other copy can be chosen. */
const KENTO_ONLY = new Set(['onnxruntime', 'bg-model']);

/** Each optional tool's state, version and path; choosing a program, checking again, updating and
 *  removing Kento's own download, and updating Kento's yt-dlp on its own (SPEC 4.2, 5.17). */
function ToolSettings() {
  const { t } = useTranslation();
  const { openSetup, language } = useApp();
  const [groups, setGroups] = useToolStatus();
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const act = (work: () => Promise<ToolGroupStatus[] | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    work()
      .then((next) => next && setGroups(next))
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setBusy(false));
  };
  // The only time Kento asks the network about yt-dlp: when this is clicked.
  const updateYtdlp = () => {
    setBusy(true);
    setUpdating(true);
    setError(null);
    setNotice(null);
    api
      .toolsUpdateYtdlp()
      .then((result) => {
        setGroups(result.status);
        setNotice(
          t(result.outcome === 'updated' ? 'settings.tools.ytdlpUpdated' : 'settings.tools.ytdlpCurrent', {
            version: result.version,
          }),
        );
      })
      .catch((err: unknown) => setError(String(err)))
      .finally(() => {
        setBusy(false);
        setUpdating(false);
      });
  };

  return (
    <Group title={t('settings.tools.title')}>
      {(groups ?? []).map((group) => (
        <div key={group.id} className="tool-group">
          <div className="tool-group-head">
            <strong>{t(`group.${group.id}`)}</strong>
            <span className="muted">
              {!group.available && !group.ready
                ? t('setup.later')
                : t(group.ready ? 'setup.ready' : 'settings.tools.missing')}
            </span>
          </div>
          {group.tools.map((tool) => (
            <div key={tool.id} className="tool-line">
              <span className="tool-name">{TOOL_NAMES[tool.id] ?? tool.id}</span>
              <span className="tool-where">
                {tool.path ? (
                  <>
                    <span>
                      {tool.version} · {t(`settings.tools.source.${tool.source ?? 'system'}`)}
                      {tool.id === 'yt-dlp' && tool.source !== 'kento' && (
                        <span className="muted"> · {t('settings.tools.ytdlpElsewhere')}</span>
                      )}
                    </span>
                    <bdi className="folder-path muted" title={tool.path}>
                      {tool.path}
                    </bdi>
                  </>
                ) : (
                  <span className="muted">{t('settings.tools.notFound')}</span>
                )}
              </span>
              <span className="tool-buttons">
                {tool.id === 'yt-dlp' && tool.source === 'kento' && (
                  <button type="button" className="button small" disabled={busy} onClick={updateYtdlp}>
                    {t(updating ? 'settings.tools.ytdlpChecking' : 'settings.tools.updateYtdlp')}
                  </button>
                )}
                {tool.source === 'custom' && (
                  <button
                    type="button"
                    className="button quiet small"
                    disabled={busy}
                    onClick={() => act(() => api.toolsClearPath(tool.id))}
                  >
                    {t('settings.tools.automatic')}
                  </button>
                )}
                {!KENTO_ONLY.has(tool.id) && (
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    onClick={() => act(() => api.toolsChoose(tool.id))}
                  >
                    {t('settings.tools.choose')}
                  </button>
                )}
              </span>
            </div>
          ))}
          {group.tools.length > 0 && (
            <div className="tool-actions">
              <button type="button" className="button small" disabled={busy} onClick={() => act(api.toolsRefresh)}>
                {t('settings.tools.verify')}
              </button>
              {group.available && (!group.ready || group.outdated) && (
                <button
                  type="button"
                  className="button primary small"
                  disabled={busy}
                  onClick={() => {
                    if (group.outdated) void api.toolsInstall(group.id);
                    openSetup();
                  }}
                >
                  {t(group.outdated ? 'settings.tools.update' : 'setup.install', {
                    size: formatBytes(group.download, language),
                  })}
                </button>
              )}
              {group.downloaded && (
                <button
                  type="button"
                  className="button quiet small"
                  disabled={busy}
                  onClick={() => act(() => api.toolsRemove(group.id))}
                >
                  {t('settings.tools.remove')}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {error && <p className="error-text">{error}</p>}
      {notice && (
        <p className="muted note" role="status">
          {notice}
        </p>
      )}
      <p className="muted note">{t('settings.tools.note')}</p>
    </Group>
  );
}

/** Plays the theme's apply sound at `sound`'s volume a moment after the last change, so the level is
 *  heard where it is set. */
function useHear(theme: string) {
  const timer = useRef<number | undefined>(undefined);
  return (sound: SettingsData['sound']) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void loadTheme(theme).then((definition) => playFor(definition.wheel, 'apply', sound));
    }, 250);
  };
}

/** The volume slider with its value beside it. */
function Volume({
  id,
  sound,
  locale,
  onChange,
}: {
  id: string;
  sound: SettingsData['sound'];
  locale: string;
  onChange: (volume: number) => void;
}) {
  return (
    <div className="volume">
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        disabled={!sound.enabled}
        value={sound.volume}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id} className="muted">
        {new Intl.NumberFormat(locale, { style: 'percent' }).format(sound.volume)}
      </output>
    </div>
  );
}

const WHEEL_KINDS = ['convert', 'tools', 'actions'] as const;
const WHEEL_KEYS: WheelKey[] = ['shift', 'control', 'alt', 'command'];

export function Settings() {
  const { t } = useTranslation();
  const { boot, settings, update, language, setSection } = useApp();
  const ids = { language: useId(), volume: useId(), jobs: useId(), keys: useId() };
  const hear = useHear(settings?.theme ?? 'steel');
  if (!boot || !settings) return null;
  const set = (patch: Partial<SettingsData>) => void update(patch);
  const theme = themeEntry(settings.theme);
  const mac = boot.app.platform === 'macos';
  const systemName =
    boot.languages.find((lang) => boot.systemLocale?.toLowerCase().startsWith(lang.code.toLowerCase()))?.name ??
    'English';

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('nav.settings')}</h1>
      </header>

      <Group title={t('settings.appearance.title')}>
        <Row label={t('settings.appearance.mode')}>
          <Segmented
            label={t('settings.appearance.mode')}
            value={settings.appearance}
            onChange={(appearance) => set({ appearance })}
            options={[
              { value: 'system', label: t('settings.appearance.system') },
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />
        </Row>
        {/* The themes have a page of their own, which keeps this one light to scroll. */}
        <Row label={t('settings.appearance.theme')}>
          <span className="row-value">
            {theme.pack === null ? t('settings.appearance.original', { name: theme.name }) : theme.name}
          </span>
          <button type="button" className="button small" onClick={() => setSection('themes')}>
            <Icon name="palette" size={16} />
            {t('settings.appearance.choose')}
          </button>
        </Row>
      </Group>

      <Group title={t('settings.language.title')}>
        <Row label={t('settings.language.title')} htmlFor={ids.language}>
          <select id={ids.language} value={settings.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="system">{t('settings.language.system', { language: systemName })}</option>
            {boot.languages.map((lang) => (
              <option key={lang.code} value={lang.code} lang={lang.code}>
                {lang.name}
              </option>
            ))}
            {import.meta.env.DEV && (
              <optgroup label={t('settings.language.test')}>
                {PSEUDO_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Row>
      </Group>

      <Group title={t('settings.wheel.title')}>
        <Row label={t('settings.wheel.global')}>
          <Switch
            label={t('settings.wheel.global')}
            checked={settings.wheels.global}
            onChange={(global) => set({ wheels: { ...settings.wheels, global } })}
          />
        </Row>
        {WHEEL_KINDS.map((kind) => (
          <Row key={kind} label={t(`settings.wheel.${kind}`)} htmlFor={`${ids.keys}-${kind}`}>
            <select
              id={`${ids.keys}-${kind}`}
              value={settings.wheels[kind]}
              disabled={!settings.wheels.global}
              onChange={(e) => {
                const key = e.target.value as WheelKey;
                // Two wheels never share a key: the one that had it takes this wheel's old key.
                const other = WHEEL_KINDS.find((k) => k !== kind && settings.wheels[k] === key);
                const wheels = { ...settings.wheels, [kind]: key };
                if (other) wheels[other] = settings.wheels[kind];
                set({ wheels });
              }}
            >
              {WHEEL_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`key.${key}.${mac ? 'mac' : 'windows'}`)}
                </option>
              ))}
            </select>
          </Row>
        ))}
        <Row label={t('settings.wheel.selection', { shortcut: mac ? '⌃⇧Space' : 'Ctrl+Shift+Space' })}>
          <Switch
            label={t('settings.wheel.selection', { shortcut: mac ? '⌃⇧Space' : 'Ctrl+Shift+Space' })}
            checked={settings.wheels.selectionShortcut}
            onChange={(selectionShortcut) => set({ wheels: { ...settings.wheels, selectionShortcut } })}
          />
        </Row>
        <Row label={t('settings.web.shortcut', { shortcut: mac ? '⌃⇧D' : 'Ctrl+Shift+D' })}>
          <Switch
            label={t('settings.web.shortcut', { shortcut: mac ? '⌃⇧D' : 'Ctrl+Shift+D' })}
            checked={settings.web.shortcut}
            onChange={(shortcut) => set({ web: { ...settings.web, shortcut } })}
          />
        </Row>
        <p className="note muted">{t('settings.wheel.note')}</p>
      </Group>

      <LayoutSettings />

      {!mac && (
        <Group title={t('settings.shell.title')}>
          <Row label={t('settings.shell.sendTo')}>
            <Switch
              label={t('settings.shell.sendTo')}
              checked={settings.shell.sendTo}
              onChange={(sendTo) => set({ shell: { ...settings.shell, sendTo } })}
            />
          </Row>
          <Row label={t('settings.shell.contextMenu')}>
            <Switch
              label={t('settings.shell.contextMenu')}
              checked={settings.shell.contextMenu}
              onChange={(contextMenu) => set({ shell: { ...settings.shell, contextMenu } })}
            />
          </Row>
        </Group>
      )}

      <Group title={t('settings.shelf.title')}>
        <Row label={t('settings.shelf.keepCopy')}>
          <Switch
            label={t('settings.shelf.keepCopy')}
            checked={settings.shelf.keepCopy}
            onChange={(keepCopy) => set({ shelf: { keepCopy } })}
          />
        </Row>
        <p className="note muted">{t('settings.shelf.note')}</p>
      </Group>

      <Group title={t('settings.feedback.title')}>
        <Row label={t('settings.feedback.sound')}>
          <Switch
            label={t('settings.feedback.sound')}
            checked={settings.sound.enabled}
            onChange={(enabled) => {
              const sound = { ...settings.sound, enabled };
              set({ sound });
              hear(sound);
            }}
          />
        </Row>
        <Row label={t('settings.feedback.volume')} htmlFor={ids.volume}>
          <Volume
            id={ids.volume}
            sound={settings.sound}
            locale={intlLocale(language)}
            onChange={(volume) => {
              const sound = { ...settings.sound, volume };
              set({ sound });
              hear(sound);
            }}
          />
        </Row>
        {mac && (
          <Row label={t('settings.feedback.haptics')}>
            <Switch
              label={t('settings.feedback.haptics')}
              checked={settings.haptics}
              onChange={(haptics) => set({ haptics })}
            />
          </Row>
        )}
        <Row label={t('settings.feedback.motion')}>
          <Segmented
            label={t('settings.feedback.motion')}
            value={settings.reducedMotion}
            onChange={(reducedMotion) => set({ reducedMotion })}
            options={[
              { value: 'system', label: t('settings.feedback.motion.system') },
              { value: 'on', label: t('settings.feedback.motion.on') },
              { value: 'off', label: t('settings.feedback.motion.off') },
            ]}
          />
        </Row>
      </Group>

      <Group title={t('settings.system.title')}>
        <Row label={t('settings.system.launch')}>
          <Switch
            label={t('settings.system.launch')}
            checked={settings.launchAtLogin}
            onChange={(launchAtLogin) => set({ launchAtLogin })}
          />
        </Row>
        <Row label={t(mac ? 'settings.system.tray.mac' : 'settings.system.tray.windows')}>
          <Switch
            label={t(mac ? 'settings.system.tray.mac' : 'settings.system.tray.windows')}
            checked={settings.trayIcon}
            onChange={(trayIcon) => set({ trayIcon })}
          />
        </Row>
      </Group>

      <Group title={t('settings.output.title')}>
        <Segmented
          label={t('settings.output.title')}
          value={settings.output.location}
          onChange={(location) => {
            if (location === 'folder' && !settings.output.folder) {
              void api.chooseFolder().then((folder) => folder && set({ output: { location: 'folder', folder } }));
            } else {
              set({ output: { ...settings.output, location } });
            }
          }}
          options={[
            { value: 'next-to-source', label: t('settings.output.next') },
            { value: 'folder', label: t('settings.output.folder') },
          ]}
        />
        {settings.output.location === 'folder' && (
          <div className="folder">
            <Icon name="folder" size={18} />
            <bdi className="folder-path">{settings.output.folder ?? t('settings.output.none')}</bdi>
            <button
              type="button"
              className="button"
              onClick={() =>
                void api.chooseFolder().then((folder) => folder && set({ output: { location: 'folder', folder } }))
              }
            >
              {t('settings.output.choose')}
            </button>
          </div>
        )}
        <p className="muted note">{t('settings.output.note')}</p>
      </Group>

      <ToolSettings />

      <Group title={t('settings.performance.title')}>
        <Row label={t('settings.performance.jobs')} htmlFor={ids.jobs}>
          <select
            id={ids.jobs}
            value={settings.concurrency ?? 'auto'}
            onChange={(e) => set({ concurrency: e.target.value === 'auto' ? null : Number(e.target.value) })}
          >
            <option value="auto">{t('settings.performance.auto', { count: boot.defaultJobs })}</option>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {new Intl.NumberFormat(intlLocale(language)).format(n)}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <UpdateSettings />

      <Group title={t('settings.privacy.title')}>
        <p className="prose">{t('settings.privacy.text')}</p>
      </Group>

      <Group title={t('settings.about.title')}>
        <div className="about">
          <img src={mark} width={64} height={64} alt="" className="about-mark" />
          <div className="about-text">
            <strong className="about-name">{t('app.name')}</strong>
            <span>{t('settings.about.version', { version: boot.app.version })}</span>
            <span>{t('settings.about.madeBy')}</span>
            <span className="muted">{t('settings.about.license')}</span>
          </div>
        </div>
        <div className="links">
          <button type="button" className="button" onClick={() => void api.openLink('website')}>
            <Icon name="link" size={16} />
            {t('settings.about.website')}
          </button>
          <button type="button" className="button" onClick={() => void api.openLink('repository')}>
            <Icon name="link" size={16} />
            {t('settings.about.github')}
          </button>
        </div>
      </Group>
    </div>
  );
}
