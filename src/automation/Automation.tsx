// SPDX-License-Identifier: MIT
// Automation (SPEC 5.11): the folder rules with their switches and Pause all, the recipes (also
// offered on the wheel's Favorites), and the activity log. Everything here is the core's state;
// the page asks again whenever the core says something changed.
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../app/Settings';
import { useNow } from '../app/useNow';
import { Icon } from '../components/Icon';
import { formatRelative } from '../i18n/format';
import { api, type Activity, type AutomationView, type Recipe, type Rule, type RuleView } from '../ipc';
import { useApp } from '../state/store';
import '../styles/automation.css';
import { describeAction, describeFilter, describeSteps, ruleName } from './describe';
import { RecipeDialog } from './RecipeDialog';
import { blankRule, RuleDialog } from './RuleDialog';

function RuleRow({
  rule,
  view,
  recipes,
  onChange,
  onEdit,
}: {
  rule: RuleView;
  view: AutomationView;
  recipes: Recipe[];
  onChange(work: Promise<AutomationView>): void;
  onEdit(rule: Rule): void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = ruleName(rule);
  return (
    <li className="rule" data-off={!rule.enabled || view.paused || undefined}>
      <Switch
        label={t('automation.rule.toggle', { name })}
        checked={rule.enabled}
        onChange={(enabled) => onChange(api.automationSetEnabled(rule.id, enabled))}
      />
      <div className="rule-text">
        <strong className="rule-name">
          <bdi>{name}</bdi>
        </strong>
        <span>
          {describeFilter(rule.filter, t, lang)} · {describeAction(rule.action, t, view.targets, recipes)}
        </span>
        <span className="rule-path">
          <span className="muted">{t('automation.rule.folder')}</span>
          <bdi className="folder-path" title={rule.folder}>
            {rule.folder}
          </bdi>
          {rule.subfolders && <span className="muted">{t('automation.rule.subfolders')}</span>}
        </span>
        <span className="rule-path">
          <span className="muted">
            {t(rule.action.kind === 'move' ? 'automation.rule.moveTo' : 'automation.rule.output')}
          </span>
          <bdi className="folder-path" title={rule.output}>
            {rule.output}
          </bdi>
        </span>
        {rule.problem ? (
          <p className="error-text rule-note">
            <Icon name="alert" size={16} />
            {t(rule.problem)}
          </p>
        ) : (
          rule.outputInside && (
            <p className="rule-warning rule-note">
              <Icon name="alert" size={16} />
              {t('automation.warning.inside')}
            </p>
          )
        )}
      </div>
      <div className="rule-actions">
        <button type="button" className="button small" onClick={() => onEdit(rule)}>
          {t('automation.edit')}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('automation.rule.delete', { name })}
          onClick={() => onChange(api.automationDeleteRule(rule.id))}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </li>
  );
}

function Recipes({
  recipes,
  view,
  onChange,
  onEdit,
}: {
  recipes: Recipe[];
  view: AutomationView;
  onChange(work: Promise<Recipe[]>): void;
  onEdit(recipe: Recipe): void;
}) {
  const { t, i18n } = useTranslation();
  const heading = useId();
  const reorder = (from: number, to: number) => {
    const ids = recipes.map((recipe) => recipe.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    onChange(api.recipesReorder(ids));
  };
  return (
    <section className="card" aria-labelledby={heading}>
      <div className="card-head">
        <h2 id={heading} className="card-title">
          {t('recipes.title')}
        </h2>
        <button type="button" className="button" onClick={() => onEdit({ id: '', name: '', steps: [] })}>
          <Icon name="plus" size={16} />
          {t('recipes.add')}
        </button>
      </div>
      {recipes.length === 0 ? (
        <p className="muted">{t('recipes.empty')}</p>
      ) : (
        <ol className="recipe-list">
          {recipes.map((recipe, index) => (
            <li key={recipe.id} className="recipe">
              <Icon name="layers" size={18} className="recipe-mark" />
              <div className="rule-text">
                <strong className="rule-name">
                  <bdi>{recipe.name}</bdi>
                </strong>
                <span className="muted">{describeSteps(recipe.steps, t, i18n.language, view.targets)}</span>
              </div>
              <div className="rule-actions">
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === 0}
                  aria-label={t('recipes.up', { name: recipe.name })}
                  onClick={() => reorder(index, index - 1)}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === recipes.length - 1}
                  aria-label={t('recipes.down', { name: recipe.name })}
                  onClick={() => reorder(index, index + 1)}
                >
                  <Icon name="down" size={16} />
                </button>
                <button type="button" className="button small" onClick={() => onEdit(recipe)}>
                  {t('automation.edit')}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('recipes.delete', { name: recipe.name })}
                  onClick={() => onChange(api.recipesDelete(recipe.id))}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="muted note">{t('recipes.note')}</p>
    </section>
  );
}

/** Shows a result in Explorer or Finder, through the Library, which opens only what Kento wrote. */
function ShowButton({ outputs }: { outputs: string[] }) {
  const { t } = useTranslation();
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const show = () =>
    void api.libraryFind(outputs).then((items) => {
      if (items[0]) void api.libraryReveal(items[0].id);
    });
  return (
    <button type="button" className="button quiet small" onClick={show}>
      <Icon name="folder" size={16} />
      {t(mac ? 'action.reveal.mac' : 'action.reveal.windows')}
    </button>
  );
}

function ActivityLog({ activity, onClear }: { activity: Activity[]; onClear(): void }) {
  const { t, i18n } = useTranslation();
  const heading = useId();
  const now = useNow();
  return (
    <section className="card" aria-labelledby={heading}>
      <div className="card-head">
        <h2 id={heading} className="card-title">
          {t('automation.activity')}
        </h2>
        {activity.length > 0 && (
          <button type="button" className="button quiet small" onClick={onClear}>
            {t('automation.activity.clear')}
          </button>
        )}
      </div>
      {activity.length === 0 ? (
        <p className="muted">{t('automation.activity.empty')}</p>
      ) : (
        <ul className="activity-list" aria-label={t('automation.activity.list')}>
          {activity.map((entry) => (
            <li key={entry.id} className="activity" data-outcome={entry.outcome}>
              <span className="activity-badge">{t(`automation.outcome.${entry.outcome}`)}</span>
              <div className="activity-text">
                <bdi className="file-name">{entry.file}</bdi>
                <span className="muted">
                  <bdi>{entry.ruleName}</bdi> · {formatRelative(entry.at, now, i18n.language)}
                </span>
                {entry.message && <span className="activity-message">{entry.message}</span>}
              </div>
              {entry.outcome === 'done' && entry.outputs.length > 0 && <ShowButton outputs={entry.outputs} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Automation() {
  const { t } = useTranslation();
  const [view, setView] = useState<AutomationView | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rulesHeading = useId();

  useEffect(() => {
    const load = () => void api.automationView().then(setView);
    const loadRecipes = () => void api.recipesList().then(setRecipes);
    load();
    loadRecipes();
    const stops = [api.onAutomation(load), api.onRecipes(loadRecipes)];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  const changed = (work: Promise<AutomationView>) => {
    setError(null);
    work.then(setView).catch((reason) => setError(String(reason)));
  };
  const recipesChanged = (work: Promise<Recipe[]>) => {
    setError(null);
    work
      .then((next) => {
        setRecipes(next);
        // A rule's recipe may be gone now.
        return api.automationView().then(setView);
      })
      .catch((reason) => setError(String(reason)));
  };

  if (!view) return null;
  const on = view.paused ? 0 : view.rules.filter((item) => item.enabled).length;

  return (
    <div className="page automation">
      <header className="page-head">
        <h1 className="page-title">{t('nav.automation')}</h1>
        <span className="muted">{t('automation.count', { count: on })}</span>
        {view.rules.length > 0 && (
          <button
            type="button"
            className="button automation-pause"
            onClick={() => changed(api.automationSetPaused(!view.paused))}
          >
            <Icon name={view.paused ? 'play' : 'pause'} size={16} />
            {t(view.paused ? 'automation.resumeAll' : 'automation.pauseAll')}
          </button>
        )}
      </header>

      {view.paused && (
        <p className="automation-paused" role="status">
          <Icon name="pause" size={16} />
          {t('automation.paused')}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby={rulesHeading}>
        <div className="card-head">
          <h2 id={rulesHeading} className="card-title">
            {t('automation.rules')}
          </h2>
          <button type="button" className="button" onClick={() => setRule(blankRule())}>
            <Icon name="plus" size={16} />
            {t('automation.addRule')}
          </button>
        </div>
        {view.rules.length === 0 ? (
          <div className="automation-empty">
            <Icon name="automation" size={32} />
            <strong>{t('automation.empty.title')}</strong>
            <p className="muted">{t('automation.empty.text')}</p>
            <p className="muted">{t('automation.empty.example')}</p>
          </div>
        ) : (
          <ul className="rule-list">
            {view.rules.map((item) => (
              <RuleRow key={item.id} rule={item} view={view} recipes={recipes} onChange={changed} onEdit={setRule} />
            ))}
          </ul>
        )}
      </section>

      <Recipes recipes={recipes} view={view} onChange={recipesChanged} onEdit={setRecipe} />
      <ActivityLog activity={view.activity} onClear={() => changed(api.automationClearActivity())} />

      {rule && <RuleDialog rule={rule} view={view} recipes={recipes} onClose={() => setRule(null)} onSaved={setView} />}
      {recipe && (
        <RecipeDialog
          recipe={recipe}
          targets={view.targets}
          onClose={() => setRecipe(null)}
          onSaved={(next) => {
            setRecipes(next);
            void api.automationView().then(setView);
          }}
        />
      )}
    </div>
  );
}
