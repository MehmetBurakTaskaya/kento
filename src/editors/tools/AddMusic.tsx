// SPDX-License-Identifier: MIT
// Add music: a piece of music mixed under a video's own sound or replacing it. The music comes from
// a file dragged in with the video or chosen here; its waveform shows where it starts and how much
// of it plays. The preview plays the music beside the video at the chosen levels, offset and fades
// (ducking is heard in the saved file only).
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { api, type MediaInfo, type MediaTool, type Mix } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { Check, Slider } from '../image/controls';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { elementVolume, FADE_MAX, fadeGain, formatLevel, gain, LEVEL, musicTime, useVolume } from '../sound';
import { Stage } from '../Stage';
import { Waveform } from '../Timeline';
import { clamp, formatNumber, formatTime } from '../time';
import { fileName, useEditor } from '../useEditor';
import type { Player } from '../usePlayer';

const MIX: Mix = {
  music: -6,
  original: 0,
  replace: false,
  duck: false,
  offset: 0,
  repeat: true,
  fadeIn: 1,
  fadeOut: 2,
};

/** Peaks for the music's small waveform. */
const MUSIC_PEAKS = 400;

interface Music {
  path: string;
  info: MediaInfo | null;
  peaks: number[] | null;
  url: string;
  error: string | null;
}

/** What is known about the chosen music: its length, waveform and a URL to preview it. */
function useMusic(path: string | null): Music | null {
  const [found, setFound] = useState<Music | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const update = (change: Partial<Music>) =>
      live &&
      setFound((current) => ({
        ...(current?.path === path ? current : { path, info: null, peaks: null, url: '', error: null }),
        ...change,
      }));
    api
      .mediaProbe(path)
      .then((info) => update({ info }))
      .catch((reason) => update({ error: String(reason) }));
    api
      .mediaPeaks(path, MUSIC_PEAKS)
      .then((peaks) => update({ peaks }))
      .catch(() => update({ peaks: [] }));
    api
      .mediaPreview(path)
      .then((preview) => update({ url: preview.url }))
      .catch((reason) => void api.log('warn', `music preview failed: ${String(reason)}`));
    return () => {
      live = false;
    };
  }, [path]);
  if (!path) return null;
  return found?.path === path ? found : { path, info: null, peaks: null, url: '', error: null };
}

/** Plays the music in step with the player, from the offset, at `volume` (0 to 1). */
function MusicSink({
  url,
  player,
  offset,
  length,
  repeat,
  volume,
}: {
  url: string;
  player: Player;
  offset: number;
  length: number;
  repeat: boolean;
  volume: number;
}) {
  const element = useRef<HTMLAudioElement>(null);
  const { playing, time } = player;
  useEffect(() => {
    const media = element.current;
    if (!media) return;
    const at = musicTime(time, offset, length, repeat);
    if (!playing || at === null) {
      if (!media.paused) media.pause();
      if (at !== null && Math.abs(media.currentTime - at) > 0.05) media.currentTime = at;
      return;
    }
    // A little drift is left alone; a jump (a seek, a repeat) moves the music along.
    if (Math.abs(media.currentTime - at) > 0.3) media.currentTime = at;
    if (media.paused) media.play().catch(() => {});
  }, [playing, time, offset, length, repeat]);
  useEffect(() => {
    if (element.current) element.current.volume = volume;
  }, [volume]);
  return <audio ref={element} src={url} preload="auto" hidden />;
}

/** The music's waveform: the part before the offset dimmed, the part that plays marked. A click
 *  sets the offset (the slider below does the same from the keyboard). */
function MusicStrip({
  peaks,
  length,
  offset,
  played,
  onOffset,
}: {
  peaks: number[];
  length: number;
  offset: number;
  played: number;
  onOffset(seconds: number): void;
}) {
  const pct = (seconds: number) => `${length > 0 ? clamp(seconds / length, 0, 1) * 100 : 0}%`;
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (event.button !== 0 || box.width === 0) return;
    onOffset(clamp((event.clientX - box.left) / box.width, 0, 1) * length);
  };
  return (
    <div className="music-strip" dir="ltr" aria-hidden="true" onPointerDown={down}>
      <Waveform peaks={peaks} />
      <span className="music-played" style={{ insetInlineStart: pct(offset), inlineSize: pct(played) }} />
      <span className="music-skipped" style={{ inlineSize: pct(offset) }} />
      <span className="music-offset" style={{ insetInlineStart: pct(offset) }} />
    </div>
  );
}

export function AddMusic(props: EditorProps) {
  const { t } = useTranslation();
  const video = props.paths.find((path) => !isAudio(path)) ?? props.paths[0] ?? '';
  const base = useEditor(video, false);
  const { lang, duration, info } = base;
  const [chosen, setChosen] = useState<string | null>(() => props.paths.find(isAudio) ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mix, setMix] = useState<Mix>(MIX);
  const music = useMusic(chosen);
  const set = (change: Partial<Mix>) => setMix((current) => ({ ...current, ...change }));

  const ownSound = Boolean(info?.audio);
  const replace = mix.replace || (info !== null && !ownSound);
  const length = music?.info?.duration ?? 0;
  const left = Math.max(0, length - mix.offset);
  const shorter = length > 0 && left < duration;
  const silentMusic = Boolean(music?.info && !music.info.audio);
  const fadeMax = Math.max(0, Math.min(FADE_MAX, duration));
  const fadeIn = Math.min(mix.fadeIn, fadeMax);
  const fadeOut = Math.min(mix.fadeOut, fadeMax);
  const request: MediaTool | null =
    info && chosen && music?.info?.audio && !music.error
      ? { tool: 'add-music', music: chosen, mix: { ...mix, replace, duck: mix.duck && !replace, fadeIn, fadeOut } }
      : null;

  // The music fades out at the video's end, or where it runs out sooner (as the engine does).
  const heard = length <= 0 || (mix.repeat && shorter) ? duration : Math.min(left, duration);
  const envelope = fadeGain(base.player.time, fadeIn, fadeOut, heard);
  const core = useVolume(base, replace ? 0 : elementVolume(gain(mix.original)));

  const pick = async () => {
    try {
      const files = await api.pickFiles();
      if (!files.length) return;
      const found = files.find(isAudio);
      if (!found) {
        setProblem(t('editor.music.notAudio'));
        return;
      }
      setChosen(found);
      set({ offset: 0 });
      setProblem(null);
    } catch (reason) {
      setProblem(String(reason));
    }
  };
  const seconds = (value: number) => t('editor.music.seconds', { value: formatNumber(value, lang, 1) });
  const db = (value: number) => t('editor.music.db', { value: formatLevel(value, lang) });

  return (
    <EditorShell
      tool="add-music"
      core={core}
      request={request}
      runPaths={[video]}
      stage={
        <>
          <Stage core={core} />
          {music?.url && (
            <MusicSink
              url={music.url}
              player={core.player}
              offset={mix.offset}
              length={length}
              repeat={mix.repeat}
              volume={elementVolume(gain(mix.music) * envelope)}
            />
          )}
        </>
      }
      {...props}
    >
      <Section title={t('editor.music.title')}>
        {chosen ? (
          <div className="music-card">
            <p className="music-name">
              <Icon name="music" size={16} />
              <bdi className="file-name">{fileName(chosen)}</bdi>
              {music?.info && <span className="muted">{formatTime(length, lang)}</span>}
            </p>
            {music?.error || silentMusic ? (
              <p className="error-text">{music?.error ?? t('editor.music.noSound')}</p>
            ) : (
              <MusicStrip
                peaks={music?.peaks ?? []}
                length={length}
                offset={mix.offset}
                played={Math.min(left, duration)}
                onOffset={(offset) => set({ offset: Math.round(offset * 10) / 10 })}
              />
            )}
          </div>
        ) : (
          <p className="editor-hint muted">{t('editor.music.empty')}</p>
        )}
        <div className="visual-pick">
          <button type="button" className="button small" onClick={() => void pick()}>
            <Icon name="music" size={16} />
            {chosen ? t('editor.music.change') : t('editor.music.choose')}
          </button>
        </div>
        {problem && <p className="error-text">{problem}</p>}
        {chosen && (
          <>
            <Slider
              label={t('editor.music.offset')}
              value={Math.min(mix.offset, Math.max(0, length - 0.1))}
              min={0}
              max={Math.max(0, length - 0.1)}
              step={0.1}
              text={formatTime(mix.offset, lang)}
              onChange={(offset) => set({ offset })}
            />
            <Check label={t('editor.music.repeat')} checked={mix.repeat} onChange={(repeat) => set({ repeat })} />
            {shorter && (
              <p className="editor-hint muted">
                {t(mix.repeat ? 'editor.music.repeats' : 'editor.music.ends', { time: formatTime(left, lang) })}
              </p>
            )}
          </>
        )}
      </Section>
      <Section title={t('editor.music.sound')}>
        {info !== null && !ownSound ? (
          <p className="editor-hint muted">{t('editor.music.silentVideo')}</p>
        ) : (
          <Segmented
            label={t('editor.music.sound')}
            value={mix.replace ? 'replace' : 'mix'}
            options={[
              { value: 'mix', label: t('editor.music.mix') },
              { value: 'replace', label: t('editor.music.replace') },
            ]}
            onChange={(value) => set({ replace: value === 'replace' })}
          />
        )}
        <Slider
          label={t('editor.music.musicLevel')}
          value={mix.music}
          min={LEVEL.min}
          max={LEVEL.max}
          step={1}
          text={db(mix.music)}
          onChange={(level) => set({ music: level })}
        />
        {!replace && (
          <>
            <Slider
              label={t('editor.music.originalLevel')}
              value={mix.original}
              min={LEVEL.min}
              max={LEVEL.max}
              step={1}
              text={db(mix.original)}
              onChange={(level) => set({ original: level })}
            />
            <Check label={t('editor.music.duck')} checked={mix.duck} onChange={(duck) => set({ duck })} />
            <p className="editor-hint muted">{t('editor.music.duckHint')}</p>
          </>
        )}
      </Section>
      <Section title={t('editor.music.fades')}>
        <Slider
          label={t('editor.music.fadeIn')}
          value={fadeIn}
          min={0}
          max={fadeMax}
          step={0.5}
          text={seconds(fadeIn)}
          onChange={(value) => set({ fadeIn: value })}
        />
        <Slider
          label={t('editor.music.fadeOut')}
          value={fadeOut}
          min={0}
          max={fadeMax}
          step={0.5}
          text={seconds(fadeOut)}
          onChange={(value) => set({ fadeOut: value })}
        />
        <p className="editor-hint muted">{t('editor.music.hint')}</p>
      </Section>
    </EditorShell>
  );
}
