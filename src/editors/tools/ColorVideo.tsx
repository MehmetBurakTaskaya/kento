// SPDX-License-Identifier: MIT
// Color and look: a ready-made look, then brightness, contrast, saturation and warmth. The picture
// shows the result live through an SVG colour matrix, the same map the engine turns into its LUT.
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Grade, Look, MediaTool } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { Slider } from '../image/controls';
import type { EditorProps } from '../panels';
import { colorMap, FLAT, isPlain, LOOKS, svgMatrix, useStill } from '../picture';
import { Stage } from '../Stage';
import { formatNumber } from '../time';
import { useEditor } from '../useEditor';

const SLIDERS: (keyof Grade)[] = ['brightness', 'contrast', 'saturation', 'warmth'];

const signed = (value: number, lang: string) =>
  value > 0 ? `+${formatNumber(value, lang)}` : value < 0 ? `−${formatNumber(-value, lang)}` : formatNumber(0, lang);

export function ColorVideo(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const [look, setLook] = useState<Look>('none');
  const [grade, setGrade] = useState<Grade>(FLAT);
  const [before, setBefore] = useState(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const still = useStill(core.path, core.player.time, core.player.playing, 200);
  // The looks are a radio group: the arrows move the choice, in the reading direction.
  const onTileKey = (event: KeyboardEvent, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    const step = steps[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = (index + step + LOOKS.length) % LOOKS.length;
    setLook(LOOKS[next]!);
    tiles.current[next]?.focus();
  };
  // An id CSS can name in url(#…), whatever characters React puts in its own.
  const base = `color-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const map = colorMap(look, grade);
  const request: MediaTool | null = core.info?.video && !isPlain(map) ? { tool: 'color-video', look, grade } : null;
  const filter = (id: string) => `url(#${base}-${id})`;

  return (
    <EditorShell
      tool="color-video"
      core={core}
      request={request}
      stage={
        <div className="color-preview" style={{ '--color-filter': before ? 'none' : filter('now') } as CSSProperties}>
          <svg className="color-filters" aria-hidden="true" focusable="false">
            <defs>
              <filter id={`${base}-now`} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={svgMatrix(map)} />
              </filter>
              {LOOKS.map((id) => (
                <filter key={id} id={`${base}-${id}`} colorInterpolationFilters="sRGB">
                  <feColorMatrix type="matrix" values={svgMatrix(colorMap(id, FLAT))} />
                </filter>
              ))}
            </defs>
          </svg>
          <Stage core={core} />
        </div>
      }
      {...props}
    >
      <Section title={t('editor.color.look')}>
        <div className="look-grid" role="radiogroup" aria-label={t('editor.color.look')}>
          {LOOKS.map((id, index) => (
            <button
              key={id}
              ref={(element) => {
                tiles.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={look === id}
              tabIndex={look === id ? 0 : -1}
              className="look-tile"
              onClick={() => setLook(id)}
              onKeyDown={(event) => onTileKey(event, index)}
            >
              <span className="look-sample" style={{ filter: filter(id) }}>
                {still ? <img src={still} alt="" /> : <span className="look-swatch" />}
              </span>
              <span className="look-name">{t(`look.${id}`)}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('editor.color.adjust')}>
        {SLIDERS.map((key) => (
          <Slider
            key={key}
            label={t(`editor.color.${key}`)}
            value={grade[key]}
            min={-100}
            max={100}
            text={signed(grade[key], core.lang)}
            onChange={(value) => setGrade((now) => ({ ...now, [key]: value }))}
          />
        ))}
        <div className="color-actions">
          <button type="button" className="button small" aria-pressed={before} onClick={() => setBefore((now) => !now)}>
            {t('editor.color.before')}
          </button>
          <button
            type="button"
            className="button small"
            disabled={look === 'none' && SLIDERS.every((key) => grade[key] === 0)}
            onClick={() => {
              setLook('none');
              setGrade(FLAT);
            }}
          >
            {t('editor.color.reset')}
          </button>
        </div>
        <p className="editor-hint muted">{t('editor.color.hint')}</p>
      </Section>
    </EditorShell>
  );
}
