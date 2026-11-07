// SPDX-License-Identifier: MIT
// Fade and volume: the sound (and a video's picture, from and to black) fades in and out, and its
// level goes up or down. The fades are drawn as ramps on the timeline, and the preview plays with
// them at the chosen level, as loud as a media element can go.
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { Check, Slider } from '../image/controls';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { elementVolume, FADE_MAX, fadeGain, formatLevel, gain, useSoundPeaks, useVolume, VOLUME } from '../sound';
import { Stage } from '../Stage';
import type { TimelineSpan } from '../Timeline';
import { formatNumber } from '../time';
import { useEditor } from '../useEditor';

export function Fade(props: EditorProps) {
  const { t } = useTranslation();
  const path = props.paths[0] ?? '';
  const audio = isAudio(path);
  const base = useEditor(path, audio);
  const { lang, duration, info } = base;
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(1);
  const [volume, setVolume] = useState(0);
  const [picture, setPicture] = useState(false);
  const hasVideo = !audio && Boolean(info?.video);
  const hasSound = Boolean(info?.audio);
  // Without sound only the picture can fade.
  const fadesPicture = hasVideo && (picture || (info !== null && !hasSound));
  const longest = Math.max(0, Math.min(FADE_MAX, duration));
  const inSeconds = Math.min(fadeIn, longest);
  const outSeconds = Math.min(fadeOut, longest);
  const fades = inSeconds > 0 || outSeconds > 0;
  const changes = (hasSound && (fades || volume !== 0)) || (fadesPicture && fades);
  const request: MediaTool | null =
    info && changes ? { tool: 'fade', fadeIn: inSeconds, fadeOut: outSeconds, picture: fadesPicture, volume } : null;

  const envelope = fadeGain(base.player.time, inSeconds, outSeconds, duration);
  const core = useVolume(base, elementVolume(envelope * gain(volume)));
  const peaks = useSoundPeaks(base);
  const spans: TimelineSpan[] = [];
  // The fade in is the "current" span, which this editor's styles draw as a rising ramp.
  if (inSeconds > 0) spans.push({ span: { start: 0, end: inSeconds }, current: true });
  if (outSeconds > 0) spans.push({ span: { start: Math.max(0, duration - outSeconds), end: duration } });
  // Passed as a whole so the timeline shows the waveform of a video's sound too.
  const timeline: { spans: TimelineSpan[]; peaks: number[] | null } = {
    spans,
    peaks: audio || hasSound ? (peaks ?? []) : null,
  };
  const seconds = (value: number) => t('editor.fade.seconds', { value: formatNumber(value, lang, 1) });

  return (
    <EditorShell
      tool="fade"
      core={core}
      request={request}
      stage={
        audio ? undefined : (
          <Stage core={core}>
            {fadesPicture && fades && (
              <span
                className="sound-fade-black"
                aria-hidden="true"
                style={{ '--fade': 1 - envelope } as CSSProperties}
              />
            )}
          </Stage>
        )
      }
      timeline={timeline}
      {...props}
    >
      <div className="sound-fade">
        <Section title={t('editor.fade.fades')}>
          <Slider
            label={t('editor.fade.in')}
            value={inSeconds}
            min={0}
            max={longest}
            step={0.1}
            text={seconds(inSeconds)}
            onChange={setFadeIn}
          />
          <Slider
            label={t('editor.fade.out')}
            value={outSeconds}
            min={0}
            max={longest}
            step={0.1}
            text={seconds(outSeconds)}
            onChange={setFadeOut}
          />
          {hasVideo && hasSound && <Check label={t('editor.fade.picture')} checked={picture} onChange={setPicture} />}
          {hasVideo && info !== null && !hasSound && (
            <p className="editor-hint muted">{t('editor.fade.pictureOnly')}</p>
          )}
        </Section>
        {(hasSound || info === null) && (
          <Section title={t('editor.fade.volume')}>
            <Slider
              label={t('editor.fade.level')}
              value={volume}
              min={VOLUME.min}
              max={VOLUME.max}
              step={0.5}
              text={t('editor.fade.db', { value: formatLevel(volume, lang) })}
              onChange={setVolume}
            />
            <p className="editor-hint muted">{t(volume > 0 ? 'editor.fade.louder' : 'editor.fade.hint')}</p>
          </Section>
        )}
      </div>
    </EditorShell>
  );
}
