// SPDX-License-Identifier: MIT
// A folder rule (SPEC 5.11): the folder to watch, which files, what to do with them and where the
// results go. Folders come only from the system's dialog; the core refuses any other. The page
// says at once when the output folder is the watched one (refused) or inside it (a warning).
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../app/Settings';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Segmented } from '../editors/controls';
import { intlLocale } from '../i18n';
import { api, type AutomationView, type Recipe, type Rule, type RuleAction } from '../ipc';
import { parseSize } from '../tools/Compress';
import { isInside } from './describe';
import { TargetOptions } from './RecipeDialog';

type ActionKind = RuleAction['kind'];

/** A size limit as typed in MB: null when empty, undefined when it is not a size. */
function sizeOf(text: string): number | null | undefined {
  if (!text.trim()) return null;
  return parseSize(text, 'MB') ?? undefined;
}

function megabytes(bytes: number | null, lang: string): string {
  if (bytes == null) return '';
  return new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 3, useGrouping: false }).format(bytes / 1e6);
}

/** "png, .JPG  heic" → ["png", "jpg", "heic"]. */
export function splitExtensions(text: string): string[] {
  const found = text
    .split(/[\s,;]+/)
    .map((ext) =>
      ext
        .trim()
        .replace(/^[*.]+/, '')
        .toLowerCase(),
    )
    .filter(Boolean);
  return [...new Set(found)];
}

/** An empty rule for the dialog: convert to WEBP, every file, nothing chosen yet. */
export function blankRule(): Rule {
  return {
    id: '',
    name: '',
    enabled: true,
    folder: '',
    subfolders: false,
    filter: { extensions: [], pattern: '', minSize: null, maxSize: null },
    action: { kind: 'convert', to: 'webp' },
    output: '',
  };
}

function FolderField({
  legend,
  path,
  onChoose,
  children,
}: {
  legend: string;
  path: string;
  onChoose(): void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="field-group">
      <legend className="field-label">{legend}</legend>
      <div className="folder">
        <Icon name="folder" size={18} />
        <bdi className={path ? 'folder-path' : 'folder-path muted'} title={path || undefined}>
          {path || t('automation.field.none')}
        </bdi>
        <button type="button" className="button" onClick={onChoose}>
          {t('automation.field.choose')}
        </button>
      </div>
      {children}
    </fieldset>
  );
}

/** A text field with a hint under it that the screen reader gives as its description. */
function TextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={`${id}-hint`} className="muted field-hint">
        {hint}
      </span>
    </div>
  );
}

export function RuleDialog({
  rule,
  view,
  recipes,
  onClose,
  onSaved,
}: {
  rule: Rule;
  view: AutomationView;
  recipes: Recipe[];
  onClose(): void;
  onSaved(view: AutomationView): void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [draft, setDraft] = useState<Rule>(rule);
  const [extensions, setExtensions] = useState(rule.filter.extensions.join(', '));
  const [pattern, setPattern] = useState(rule.filter.pattern);
  const [min, setMin] = useState(megabytes(rule.filter.minSize, lang));
  const [max, setMax] = useState(megabytes(rule.filter.maxSize, lang));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Rule>) => setDraft((current) => ({ ...current, ...patch }));
  const choose = (field: 'folder' | 'output') =>
    void api
      .automationChooseFolder()
      .then((folder) => folder && set(field === 'folder' ? { folder } : { output: folder }))
      .catch((reason) => setError(String(reason)));

  const minSize = sizeOf(min);
  const maxSize = sizeOf(max);
  const sizesBad = minSize != null && maxSize != null && minSize > maxSize;
  const same = !!draft.folder && !!draft.output && isInside(draft.folder, draft.output);
  const inner = !!draft.folder && !!draft.output && !same && isInside(draft.output, draft.folder);
  const action = draft.action;
  const actionReady =
    action.kind === 'move' ||
    (action.kind === 'convert' && view.targets.some((target) => target.id === action.to)) ||
    (action.kind === 'tool' && view.tools.includes(action.tool)) ||
    (action.kind === 'recipe' && recipes.some((recipe) => recipe.id === action.recipe));
  const ready =
    !!draft.folder &&
    !!draft.output &&
    !same &&
    actionReady &&
    minSize !== undefined &&
    maxSize !== undefined &&
    !sizesBad;

  const setKind = (kind: ActionKind) => {
    if (kind === action.kind) return;
    const next: Record<ActionKind, RuleAction> = {
      convert: {
        kind: 'convert',
        to: view.targets.some((target) => target.id === 'webp') ? 'webp' : (view.targets[0]?.id ?? ''),
      },
      recipe: { kind: 'recipe', recipe: recipes[0]?.id ?? '' },
      tool: { kind: 'tool', tool: view.tools[0] ?? '' },
      move: { kind: 'move' },
    };
    set({ action: next[kind] });
  };

  const save = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    api
      .automationSaveRule({
        ...draft,
        name: draft.name.trim(),
        filter: {
          extensions: splitExtensions(extensions),
          pattern: pattern.trim(),
          minSize: minSize ?? null,
          maxSize: maxSize ?? null,
        },
      })
      .then((saved) => {
        onSaved(saved);
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
      title={t(rule.id ? 'automation.dialog.edit' : 'automation.dialog.new')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={!ready || busy} onClick={save}>
            {t('automation.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{t('automation.field.name')}</span>
        <input
          type="text"
          value={draft.name}
          maxLength={80}
          placeholder={t('automation.field.optional')}
          onChange={(event) => set({ name: event.target.value })}
        />
      </label>

      <FolderField legend={t('automation.field.folder')} path={draft.folder} onChoose={() => choose('folder')}>
        <div className="row">
          <span className="row-label">{t('automation.field.subfolders')}</span>
          <div className="row-control">
            <Switch
              label={t('automation.field.subfolders')}
              checked={draft.subfolders}
              onChange={(subfolders) => set({ subfolders })}
            />
          </div>
        </div>
      </FolderField>

      <fieldset className="field-group">
        <legend className="field-label">{t('automation.field.files')}</legend>
        <div className="field-row">
          <TextField
            label={t('automation.field.extensions')}
            hint={t('automation.field.extensionsHint')}
            value={extensions}
            onChange={setExtensions}
          />
          <TextField
            label={t('automation.field.pattern')}
            hint={t('automation.field.patternHint')}
            value={pattern}
            onChange={setPattern}
          />
        </div>
        <div className="field-row">
          <label className="field">
            <span>{t('automation.field.minSize')}</span>
            <input
              type="text"
              inputMode="decimal"
              className="size-input"
              value={min}
              aria-invalid={minSize === undefined || sizesBad}
              onChange={(event) => setMin(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('automation.field.maxSize')}</span>
            <input
              type="text"
              inputMode="decimal"
              className="size-input"
              value={max}
              aria-invalid={maxSize === undefined || sizesBad}
              onChange={(event) => setMax(event.target.value)}
            />
          </label>
        </div>
        {sizesBad && <p className="error-text">{t('automation.error.sizes')}</p>}
      </fieldset>

      <fieldset className="field-group">
        <legend className="field-label">{t('automation.field.action')}</legend>
        <Segmented<ActionKind>
          label={t('automation.field.action')}
          value={action.kind}
          options={[
            { value: 'convert', label: t('automation.kind.convert') },
            { value: 'recipe', label: t('automation.kind.recipe') },
            { value: 'tool', label: t('automation.kind.tool') },
            { value: 'move', label: t('automation.kind.move') },
          ]}
          onChange={setKind}
        />
        {action.kind === 'convert' && (
          <label className="field">
            <span>{t('automation.field.to')}</span>
            <select
              value={action.to}
              onChange={(event) => set({ action: { kind: 'convert', to: event.target.value } })}
            >
              <TargetOptions targets={view.targets} />
            </select>
          </label>
        )}
        {action.kind === 'recipe' &&
          (recipes.length ? (
            <label className="field">
              <span>{t('automation.field.recipe')}</span>
              <select
                value={action.recipe}
                onChange={(event) => set({ action: { kind: 'recipe', recipe: event.target.value } })}
              >
                {!recipes.some((recipe) => recipe.id === action.recipe) && <option value={action.recipe} />}
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">{t('automation.field.noRecipes')}</p>
          ))}
        {action.kind === 'tool' && (
          <label className="field">
            <span>{t('automation.field.tool')}</span>
            <select
              value={action.tool}
              onChange={(event) => set({ action: { kind: 'tool', tool: event.target.value } })}
            >
              {view.tools.map((tool) => (
                <option key={tool} value={tool}>
                  {t(`tool.${tool}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {action.kind === 'move' && <p className="muted">{t('automation.field.moveNote')}</p>}
      </fieldset>

      <FolderField
        legend={t(action.kind === 'move' ? 'automation.field.moveTo' : 'automation.field.output')}
        path={draft.output}
        onChoose={() => choose('output')}
      >
        {same && (
          <p className="error-text" role="alert">
            {t('automation.field.sameFolder')}
          </p>
        )}
        {inner && (
          <p className="rule-warning">
            <Icon name="alert" size={16} />
            {t('automation.warning.inside')}
          </p>
        )}
      </FolderField>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
