// SPDX-License-Identifier: MIT
// Recipes and folder rules in words: the step list of a recipe ("Crop 4:5 · Resize to 1080 px ·
// Compress under 2 MB"), what a rule takes and what it does. Shared by the Automation page and
// the wheel's Favorites ring.
import type { TFunction } from 'i18next';
import { formatBytes, upper } from '../i18n/format';
import type { ConvertFormat, Recipe, RecipeStep, Rule, RuleAction, RuleFilter } from '../ipc';

/** A format's label, as the catalog writes it ("TAR.GZ"), or its id in capitals. */
export function formatLabel(id: string, targets: ConvertFormat[], lang: string): string {
  return targets.find((target) => target.id === id)?.label ?? upper(id, lang);
}

export function describeStep(step: RecipeStep, t: TFunction, lang: string, targets: ConvertFormat[] = []): string {
  switch (step.kind) {
    case 'convert':
      return t('recipes.step.convert', { format: formatLabel(step.to, targets, lang) });
    case 'crop':
      return t('recipes.step.crop', { width: step.width, height: step.height });
    case 'resize':
      return t('recipes.step.resize', { size: step.longSide });
    case 'compress': {
      const compression = step.compression;
      if (compression.mode === 'quality') return t('recipes.step.quality', { level: compression.level });
      if (compression.mode === 'ratio') return t('recipes.step.ratio', { value: compression.percent / 100 });
      return t('recipes.step.size', { size: formatBytes(compression.bytes, lang) });
    }
  }
}

export function describeSteps(steps: RecipeStep[], t: TFunction, lang: string, targets: ConvertFormat[] = []): string {
  return steps.map((step) => describeStep(step, t, lang, targets)).join(' · ');
}

/** "PNG, JPG · named Screenshot* · at least 100 kB", or "All files". */
export function describeFilter(filter: RuleFilter, t: TFunction, lang: string): string {
  const parts = [
    filter.extensions.map((ext) => upper(ext, lang)).join(', '),
    filter.pattern && t('automation.filter.pattern', { pattern: filter.pattern }),
    filter.minSize != null && t('automation.filter.min', { size: formatBytes(filter.minSize, lang) }),
    filter.maxSize != null && t('automation.filter.max', { size: formatBytes(filter.maxSize, lang) }),
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : t('automation.filter.all');
}

export function describeAction(
  action: RuleAction,
  t: TFunction,
  lang: string,
  targets: ConvertFormat[],
  recipes: Recipe[],
): string {
  switch (action.kind) {
    case 'convert':
      return t('automation.action.convert', { format: formatLabel(action.to, targets, lang) });
    case 'tool':
      return t(`tool.${action.tool}`);
    case 'recipe':
      return t('automation.action.recipe', {
        name: recipes.find((recipe) => recipe.id === action.recipe)?.name ?? action.recipe,
      });
    case 'move':
      return t('automation.action.move');
  }
}

/** The rule's name, or its folder's when it has none. */
export function ruleName(rule: Rule): string {
  return rule.name.trim() || folderName(rule.folder);
}

/** The last part of a path, Windows or POSIX. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The parts of a path for comparing, case ignored as on Windows and macOS. */
function parts(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
}

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  const [inner, outer] = [parts(path), parts(folder)];
  return outer.length > 0 && inner.length >= outer.length && outer.every((part, index) => inner[index] === part);
}
