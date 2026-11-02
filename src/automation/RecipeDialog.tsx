// SPDX-License-Identifier: MIT
// A recipe's name and steps (SPEC 5.11): convert, crop to a ratio, resize the longer side and
// compress, in any order the user sets. Each step is checked here as the core checks it, so Save
// is ready only for a recipe the core takes.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { intlLocale } from '../i18n';
import { api, type Category, type Compression, type ConvertFormat, type Recipe, type RecipeStep } from '../ipc';
import { parseSize } from '../tools/Compress';
import { move } from '../tools/OrderList';

export type StepKind = RecipeStep['kind'];
const KINDS: StepKind[] = ['convert', 'crop', 'resize', 'compress'];
const RATIOS = ['1:1', '4:5', '5:4', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'];
const CUSTOM = 'custom';
/** The core's limits (engines `recipe::MAX_*`). */
export const LIMITS = { name: 80, steps: 12, ratio: 1000, side: 65_535 };

/** A step as the form holds it: numbers as typed. */
export type StepDraft =
  | { kind: 'convert'; to: string }
  | { kind: 'crop'; ratio: string; width: string; height: string }
  | { kind: 'resize'; longSide: string }
  | { kind: 'compress'; mode: Compression['mode']; value: string };

/** A whole number in a range, or null. */
function whole(text: string, min: number, max: number): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function draftOf(step: RecipeStep, lang: string): StepDraft {
  switch (step.kind) {
    case 'convert':
      return { kind: 'convert', to: step.to };
    case 'crop': {
      const ratio = `${step.width}:${step.height}`;
      return {
        kind: 'crop',
        ratio: RATIOS.includes(ratio) ? ratio : CUSTOM,
        width: String(step.width),
        height: String(step.height),
      };
    }
    case 'resize':
      return { kind: 'resize', longSide: String(step.longSide) };
    case 'compress': {
      const compression = step.compression;
      const value =
        compression.mode === 'quality'
          ? String(compression.level)
          : compression.mode === 'ratio'
            ? String(compression.percent)
            : new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 3, useGrouping: false }).format(
                compression.bytes / 1e6,
              );
      return { kind: 'compress', mode: compression.mode, value };
    }
  }
}

/** The step the core gets, or null while a value is out of range. */
export function stepOf(draft: StepDraft): RecipeStep | null {
  switch (draft.kind) {
    case 'convert':
      return draft.to ? { kind: 'convert', to: draft.to } : null;
    case 'crop': {
      const width = whole(draft.width, 1, LIMITS.ratio);
      const height = whole(draft.height, 1, LIMITS.ratio);
      return width && height ? { kind: 'crop', width, height } : null;
    }
    case 'resize': {
      const longSide = whole(draft.longSide, 1, LIMITS.side);
      return longSide ? { kind: 'resize', longSide } : null;
    }
    case 'compress': {
      if (draft.mode === 'quality') {
        const level = whole(draft.value, 1, 100);
        return level ? { kind: 'compress', compression: { mode: 'quality', level } } : null;
      }
      if (draft.mode === 'ratio') {
        const percent = whole(draft.value, 5, 95);
        return percent ? { kind: 'compress', compression: { mode: 'ratio', percent } } : null;
      }
      const bytes = parseSize(draft.value, 'MB');
      return bytes ? { kind: 'compress', compression: { mode: 'size', bytes } } : null;
    }
  }
}

/** A new step of a kind, with a sensible first value. */
export function freshStep(kind: StepKind, targets: ConvertFormat[]): StepDraft {
  switch (kind) {
    case 'convert':
      return { kind, to: targets.find((target) => target.id === 'jpg')?.id ?? targets[0]?.id ?? '' };
    case 'crop':
      return { kind, ratio: '1:1', width: '1', height: '1' };
    case 'resize':
      return { kind, longSide: '1080' };
    case 'compress':
      return { kind, mode: 'quality', value: '75' };
  }
}

/** The formats grouped by category, as the Convert wheel groups them. */
export function TargetOptions({ targets }: { targets: ConvertFormat[] }) {
  const { t } = useTranslation();
  const categories = [...new Set(targets.map((target) => target.category))] as Category[];
  return (
    <>
      {categories.map((category) => (
        <optgroup key={category} label={t(`category.${category}`)}>
          {targets
            .filter((target) => target.category === category)
            .map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function StepFields({
  draft,
  targets,
  onChange,
}: {
  draft: StepDraft;
  targets: ConvertFormat[];
  onChange(next: StepDraft): void;
}) {
  const { t } = useTranslation();
  const invalid = stepOf(draft) === null;
  switch (draft.kind) {
    case 'convert':
      return (
        <select
          aria-label={t('recipes.field.to')}
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
        >
          <TargetOptions targets={targets} />
        </select>
      );
    case 'crop':
      return (
        <>
          <select
            aria-label={t('recipes.field.ratio')}
            value={draft.ratio}
            onChange={(event) => {
              const ratio = event.target.value;
              const [width = draft.width, height = draft.height] = ratio === CUSTOM ? [] : ratio.split(':');
              onChange({ ...draft, ratio, width, height });
            }}
          >
            {RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
            <option value={CUSTOM}>{t('recipes.ratio.custom')}</option>
          </select>
          {draft.ratio === CUSTOM && (
            <>
              <input
                type="number"
                min={1}
                max={LIMITS.ratio}
                aria-label={t('recipes.field.ratioWidth')}
                aria-invalid={invalid}
                value={draft.width}
                onChange={(event) => onChange({ ...draft, width: event.target.value })}
              />
              <span aria-hidden="true">:</span>
              <input
                type="number"
                min={1}
                max={LIMITS.ratio}
                aria-label={t('recipes.field.ratioHeight')}
                aria-invalid={invalid}
                value={draft.height}
                onChange={(event) => onChange({ ...draft, height: event.target.value })}
              />
            </>
          )}
        </>
      );
    case 'resize':
      return (
        <>
          <input
            type="number"
            min={1}
            max={LIMITS.side}
            aria-label={t('recipes.field.longSide')}
            aria-invalid={invalid}
            value={draft.longSide}
            onChange={(event) => onChange({ ...draft, longSide: event.target.value })}
          />
          <span className="muted step-hint">{t('recipes.field.resizeHint')}</span>
        </>
      );
    case 'compress': {
      const label = {
        quality: t('recipes.field.quality'),
        ratio: t('recipes.field.percent'),
        size: t('recipes.field.size'),
      };
      return (
        <>
          <select
            aria-label={t('recipes.field.compressBy')}
            value={draft.mode}
            onChange={(event) => {
              const mode = event.target.value as Compression['mode'];
              const value = { quality: '75', ratio: '50', size: '2' }[mode];
              onChange({ ...draft, mode, value });
            }}
          >
            <option value="quality">{label.quality}</option>
            <option value="ratio">{label.ratio}</option>
            <option value="size">{label.size}</option>
          </select>
          <input
            type="text"
            inputMode="decimal"
            className="step-value"
            aria-label={label[draft.mode]}
            aria-invalid={invalid}
            value={draft.value}
            onChange={(event) => onChange({ ...draft, value: event.target.value })}
          />
        </>
      );
    }
  }
}

export function RecipeDialog({
  recipe,
  targets,
  onClose,
  onSaved,
}: {
  recipe: Recipe;
  targets: ConvertFormat[];
  onClose(): void;
  onSaved(recipes: Recipe[]): void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(recipe.name);
  const [steps, setSteps] = useState<StepDraft[]>(() => recipe.steps.map((step) => draftOf(step, i18n.language)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const built = steps.map(stepOf);
  const valid =
    name.trim() !== '' &&
    steps.length > 0 &&
    steps.length <= LIMITS.steps &&
    built.every((step): step is RecipeStep => step !== null);

  const change = (index: number, next: StepDraft) =>
    setSteps((current) => current.map((draft, at) => (at === index ? next : draft)));

  const save = () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    api
      .recipesSave({ id: recipe.id, name: name.trim(), steps: built as RecipeStep[] })
      .then((recipes) => {
        onSaved(recipes);
        onClose();
      })
      .catch((reason) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  return (
    <Dialog
      wide
      title={t(recipe.id ? 'recipes.dialog.edit' : 'recipes.dialog.new')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={!valid || busy} onClick={save}>
            {t('automation.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{t('recipes.field.name')}</span>
        <input
          type="text"
          value={name}
          maxLength={LIMITS.name}
          aria-invalid={name.trim() === ''}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <fieldset className="field-group">
        <legend className="field-label">{t('recipes.field.steps')}</legend>
        <ol className="step-list">
          {steps.map((draft, index) => {
            const position = index + 1;
            return (
              <li key={index} className="step">
                <span className="order-index">{position}</span>
                <select
                  aria-label={t('recipes.field.kind', { position })}
                  value={draft.kind}
                  onChange={(event) => change(index, freshStep(event.target.value as StepKind, targets))}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`recipes.kind.${kind}`)}
                    </option>
                  ))}
                </select>
                <div className="step-fields">
                  <StepFields draft={draft} targets={targets} onChange={(next) => change(index, next)} />
                </div>
                <div className="step-buttons">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    aria-label={t('recipes.step.up', { position })}
                    onClick={() => setSteps(move(steps, index, index - 1))}
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === steps.length - 1}
                    aria-label={t('recipes.step.down', { position })}
                    onClick={() => setSteps(move(steps, index, index + 1))}
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('recipes.step.remove', { position })}
                    onClick={() => setSteps(steps.filter((_, at) => at !== index))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="button small step-add"
          disabled={steps.length >= LIMITS.steps}
          onClick={() => setSteps([...steps, freshStep('resize', targets)])}
        >
          <Icon name="plus" size={16} />
          {t('recipes.step.add')}
        </button>
      </fieldset>
      {!valid && <p className="muted note">{t('recipes.invalid')}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
