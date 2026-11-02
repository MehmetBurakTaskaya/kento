// SPDX-License-Identifier: MIT
// The web download dialog (SPEC 5.10), opened by a link pasted or dropped on Home, by the download
// shortcut and by the floating wheel's More…. It reads what the link holds, then offers what fits:
// video with a short quality list, the sound as MP3, a YouTube thumbnail on its own, the pictures
// of an Instagram post, or the original; and the folder to save in. What Kento cannot download is
// said plainly, and the first time ever a short notice asks for content the user may download.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon, type IconName } from '../components/Icon';
import { formatTime } from '../editors/time';
import { api, type WebInfo, type WebProblem } from '../ipc';
import { useApp } from '../state/store';
import {
  choiceFor,
  defaultHeight,
  needsSetup,
  optionsFor,
  problemOf,
  qualityKey,
  retryable,
  siteName,
  type WebOption,
} from './links';

/** Product names, the same in every language. */
const SITE_NAMES: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram' };

const OPTION_ICONS: Record<WebOption, IconName> = {
  video: 'video',
  audio: 'music',
  thumbnail: 'frame',
  images: 'grid',
  original: 'file',
};

type Stage =
  { name: 'probing' } | { name: 'setup' } | { name: 'ready'; info: WebInfo } | { name: 'failed'; problem: WebProblem };

export function WebDialog() {
  const web = useApp((state) => state.web);
  return web ? <Download key={web.url} url={web.url} /> : null;
}

function Download({ url }: { url: string }) {
  const { t } = useTranslation();
  const closeWeb = useApp((state) => state.closeWeb);
  const [stage, setStage] = useState<Stage>({ name: 'probing' });
  const [attempt, setAttempt] = useState(0);
  // The notice belongs to the first dialog ever; it stays while this one is open.
  const [firstUse] = useState(() => useApp.getState().settings?.web.noticeShown === false);

  useEffect(() => {
    if (!firstUse) return;
    const { settings, update } = useApp.getState();
    if (settings) void update({ web: { ...settings.web, noticeShown: true } });
  }, [firstUse]);

  // Each try starts in the probing stage: the first by its initial state, another by `retry`.
  useEffect(() => {
    let live = true;
    api
      .webNeeds()
      .then((needs) => {
        if (!live) return;
        if (needs) return setStage({ name: 'setup' });
        return api.webProbe(url).then(
          (info) => live && setStage({ name: 'ready', info }),
          (reason: unknown) => live && setStage({ name: 'failed', problem: problemOf(reason) }),
        );
      })
      .catch((reason: unknown) => live && setStage({ name: 'failed', problem: problemOf(reason) }));
    return () => {
      live = false;
    };
  }, [url, attempt]);

  const setup = () => {
    closeWeb();
    useApp.getState().openSetup();
  };
  const retry = () => {
    setStage({ name: 'probing' });
    setAttempt((n) => n + 1);
  };
  const notice = firstUse && (
    <p className="web-notice" role="note">
      <Icon name="alert" size={18} />
      <span>{t('web.notice')}</span>
    </p>
  );

  if (stage.name === 'ready') return <Choices url={url} info={stage.info} notice={notice} onClose={closeWeb} />;
  return (
    <Dialog
      title={t('web.title')}
      onClose={closeWeb}
      footer={
        <button type="button" className="button quiet" onClick={closeWeb}>
          {t('tools.cancel')}
        </button>
      }
    >
      {notice}
      <div className="web-state" aria-live="polite">
        {stage.name === 'probing' && <Probing url={url} />}
        {stage.name === 'setup' && (
          <>
            <p>{t('web.setup')}</p>
            <div className="web-actions">
              <button type="button" className="button primary" onClick={setup}>
                {t('setup.open')}
              </button>
            </div>
          </>
        )}
        {stage.name === 'failed' && <Failed problem={stage.problem} onRetry={retry} onSetup={setup} />}
      </div>
      <Unsupported />
    </Dialog>
  );
}

function Probing({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <div className="web-probing">
      <span className="scale" role="progressbar" aria-label={t('web.probing')} data-indeterminate>
        <span />
      </span>
      <p>
        {t('web.probing')} <bdi className="muted">{siteName(url)}</bdi>
      </p>
    </div>
  );
}

function Failed({ problem, onRetry, onSetup }: { problem: WebProblem; onRetry(): void; onSetup(): void }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="web-failed">
      <p className="web-problem">
        <Icon name="alert" size={18} />
        <span>{t(i18n.exists(problem.key) ? problem.key : 'error.other')}</span>
      </p>
      <div className="web-actions">
        {needsSetup(problem) && (
          <button type="button" className="button primary" onClick={onSetup}>
            {t('setup.open')}
          </button>
        )}
        {retryable(problem) && (
          <button type="button" className="button" onClick={onRetry}>
            <Icon name="restart" size={16} />
            {t('web.retry')}
          </button>
        )}
        {problem.details && (
          <button
            type="button"
            className="button quiet"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(problem.details)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {t(copied ? 'toast.copied' : 'toast.details')}
          </button>
        )}
      </div>
    </div>
  );
}

/** What Kento never downloads, always in view (SPEC 5.10). */
function Unsupported() {
  const { t } = useTranslation();
  return <p className="note muted web-unsupported">{t('web.unsupported')}</p>;
}

function Choices({ url, info, notice, onClose }: { url: string; info: WebInfo; notice: ReactNode; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const started = useApp((state) => state.started);
  const ids = { options: useId(), quality: useId(), folder: useId() };
  const options = optionsFor(info);
  const [option, setOption] = useState<WebOption>(options[0]!);
  const [height, setHeight] = useState<number | null>(() => defaultHeight(info.heights));
  // Every picture is picked at first.
  const [picked, setPicked] = useState<number[]>(() => info.images.map((image) => image.index));
  const [folder, setFolder] = useState<string | null>(null);
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.webDefaultFolder().then((path) => live && setShown(path));
    return () => {
      live = false;
    };
  }, []);

  const choice = choiceFor(option, height, picked);
  const site = SITE_NAMES[info.site] ?? siteName(url);
  const facts = [
    site,
    info.kind === 'images'
      ? t('web.pictures', { count: info.images.length })
      : t(info.kind === 'audio' ? 'web.kind.audio' : 'web.kind.video'),
    info.duration ? formatTime(info.duration, lang, false) : null,
  ].filter(Boolean);

  const choose = () =>
    void api.webChooseFolder().then((path) => {
      if (!path) return;
      setFolder(path);
      setShown(path);
    });

  const download = () => {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    api
      .webDownload(url, choice, folder)
      .then((id) => {
        started([id]);
        onClose();
      })
      .catch((reason: unknown) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  return (
    <Dialog
      title={t('web.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={!choice || busy} onClick={download}>
            <Icon name="drop" size={16} />
            {t('web.download')}
          </button>
        </>
      }
    >
      {notice}
      <div className="web-info">
        <strong className="web-title">
          <bdi>{info.title || siteName(url)}</bdi>
        </strong>
        <span className="muted web-facts">{facts.join(' · ')}</span>
      </div>

      {/* A photo post on Instagram has nothing to choose but its pictures. */}
      {options.length > 1 && (
        <fieldset className="web-options">
          <legend>{t('web.choose')}</legend>
          {options.map((value) => (
            <label key={value} className="web-option" data-on={option === value || undefined}>
              <input
                type="radio"
                name={ids.options}
                value={value}
                checked={option === value}
                onChange={() => setOption(value)}
              />
              <Icon name={OPTION_ICONS[value]} size={20} />
              <span className="web-option-text">
                <span className="web-option-name">{t(`web.option.${value}`)}</span>
                <span className="muted">{t(`web.option.${value}.detail`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {option === 'video' && info.heights.length > 0 && (
        <div className="web-row">
          <label htmlFor={ids.quality}>{t('web.quality.title')}</label>
          <select id={ids.quality} value={height ?? ''} onChange={(event) => setHeight(Number(event.target.value))}>
            {info.heights.map((value) => (
              <option key={value} value={value}>
                {t(qualityKey(value), { height: value })}
              </option>
            ))}
          </select>
        </div>
      )}

      {option === 'images' && <Pictures url={url} info={info} picked={picked} onPick={setPicked} />}

      <div className="web-folder" role="group" aria-labelledby={ids.folder}>
        <span id={ids.folder}>{t('web.folder.title')}</span>
        <span className="folder">
          <Icon name="folder" size={18} />
          <bdi className="folder-path" title={shown}>
            {shown}
          </bdi>
          <button type="button" className="button small" onClick={choose}>
            {t('web.folder.change')}
          </button>
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}
      <Unsupported />
    </Dialog>
  );
}

/** The pictures of a photo post, all picked at first; they are saved in the post's order. */
function Pictures({
  url,
  info,
  picked,
  onPick,
}: {
  url: string;
  info: WebInfo;
  picked: number[];
  onPick(next: number[]): void;
}) {
  const { t } = useTranslation();
  const title = useId();
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const all = picked.length === info.images.length;

  // The core fetches each preview the probe named; the page itself goes nowhere.
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    let live = true;
    const made: string[] = [];
    for (const image of info.images.filter((item) => item.preview)) {
      void api.webPreview(url, image.index).then((blob) => {
        if (!blob || !live) return;
        const address = URL.createObjectURL(blob);
        made.push(address);
        setPreviews((current) => ({ ...current, [image.index]: address }));
      });
    }
    return () => {
      live = false;
      made.forEach((address) => URL.revokeObjectURL(address));
    };
  }, [url, info]);

  const toggle = (index: number) =>
    onPick(picked.includes(index) ? picked.filter((item) => item !== index) : [...picked, index]);

  return (
    <div className="web-pictures">
      <span className="web-pictures-head">
        <strong id={title}>{t('web.pictures.title')}</strong>
        <span className="muted">{t('web.picked', { count: picked.length, total: info.images.length })}</span>
      </span>
      <ul className="web-picture-grid" aria-labelledby={title}>
        {info.images.map((image) => {
          const number = image.index + 1;
          const on = picked.includes(image.index);
          return (
            <li key={image.index}>
              <label className="web-picture" data-on={on || undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={t('web.picture', { number })}
                  onChange={() => toggle(image.index)}
                />
                {previews[image.index] ? <img src={previews[image.index]} alt="" /> : <Icon name="image" size={28} />}
                <span className="web-picture-number" aria-hidden="true">
                  {number}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {/* After the pictures, so the dialog's first focus lands on a picture, not on this. */}
      <button
        type="button"
        className="button quiet small web-pick-all"
        onClick={() => onPick(all ? [] : info.images.map((image) => image.index))}
      >
        {t(all ? 'web.pictures.none' : 'web.pictures.all')}
      </button>
    </div>
  );
}
