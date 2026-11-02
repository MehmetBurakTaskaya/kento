// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Activity, type AutomationView, type Recipe, type RuleView } from '../ipc';
import { Automation } from './Automation';
import { draftOf, stepOf } from './RecipeDialog';

const TARGETS: AutomationView['targets'] = [
  { id: 'jpg', label: 'JPG', category: 'image' },
  { id: 'webp', label: 'WEBP', category: 'image' },
  { id: 'pdf', label: 'PDF', category: 'pdf' },
];

const INSTAGRAM: Recipe = {
  id: 'ready-for-instagram',
  name: 'Ready for Instagram',
  steps: [
    { kind: 'crop', width: 4, height: 5 },
    { kind: 'resize', longSide: 1080 },
    { kind: 'compress', compression: { mode: 'size', bytes: 2_000_000 } },
  ],
};

function rule(patch: Partial<RuleView> = {}): RuleView {
  return {
    id: 'shots',
    name: 'Ekran görüntüleri',
    enabled: true,
    folder: 'C:\\Users\\ayşe\\Pictures\\Screenshots',
    subfolders: false,
    filter: { extensions: ['png'], pattern: '', minSize: null, maxSize: null },
    action: { kind: 'convert', to: 'webp' },
    output: 'C:\\Users\\ayşe\\Pictures\\Optimized',
    outputInside: false,
    problem: null,
    ...patch,
  };
}

function activity(id: number, outcome: Activity['outcome'], patch: Partial<Activity> = {}): Activity {
  return {
    id,
    at: Date.now() - id * 60_000,
    rule: 'shots',
    ruleName: 'Ekran görüntüleri',
    file: `görüntü ${id} 🖼️.png`,
    outcome,
    message: null,
    outputs: [],
    ...patch,
  };
}

function view(patch: Partial<AutomationView> = {}): AutomationView {
  return { paused: false, rules: [], activity: [], targets: TARGETS, tools: ['extract', 'mute'], ...patch };
}

function open(shown: AutomationView, recipes: Recipe[] = [INSTAGRAM]) {
  vi.spyOn(api, 'automationView').mockResolvedValue(shown);
  vi.spyOn(api, 'recipesList').mockResolvedValue(recipes);
  return render(<Automation />);
}

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('automation page', () => {
  it('explains rules when there are none and lists the example recipe', async () => {
    open(view());
    expect(await screen.findByText('No rules yet')).toBeTruthy();
    expect(screen.getByText(/^A rule watches a folder/)).toBeTruthy();
    expect(screen.getByText('Ready for Instagram')).toBeTruthy();
    expect(screen.getByText('Crop 4:5 · Resize to 1080 px · Compress under 2 MB')).toBeTruthy();
    expect(screen.getByText('Nothing yet. The files your rules handle are listed here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause all' })).toBeNull();
    expect(screen.getByText('0 rules on')).toBeTruthy();
  });

  it('lists rules with their switch, what they do, warnings and problems', async () => {
    const setEnabled = vi.spyOn(api, 'automationSetEnabled').mockResolvedValue(view());
    open(
      view({
        rules: [
          rule(),
          rule({
            id: 'insta',
            name: '',
            folder: 'C:\\Users\\ayşe\\Desktop\\Instagram 📷',
            output: 'C:\\Users\\ayşe\\Desktop\\Instagram 📷\\Hazır',
            subfolders: true,
            filter: { extensions: ['jpg', 'heic'], pattern: 'IMG_*', minSize: 100_000, maxSize: null },
            action: { kind: 'recipe', recipe: 'ready-for-instagram' },
            outputInside: true,
          }),
          rule({
            id: 'zips',
            name: 'Arşivler',
            enabled: false,
            action: { kind: 'tool', tool: 'extract' },
            problem: 'automation.problem.output',
          }),
        ],
      }),
    );
    const first = await screen.findByRole('switch', { name: 'Rule: Ekran görüntüleri' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Rule: Arşivler' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('2 rules on')).toBeTruthy();
    expect(screen.getByText('PNG · Convert to WEBP')).toBeTruthy();
    // A rule without a name goes by its folder.
    expect(screen.getByRole('switch', { name: 'Rule: Instagram 📷' })).toBeTruthy();
    expect(screen.getByText('JPG, HEIC · named IMG_* · at least 100 kB · Recipe: Ready for Instagram')).toBeTruthy();
    expect(screen.getByText('with subfolders')).toBeTruthy();
    expect(screen.getByText(/^The output folder is inside the watched folder/)).toBeTruthy();
    expect(screen.getByText('The output folder is gone.')).toBeTruthy();
    expect(screen.getByText('PNG · Extract archive')).toBeTruthy();
    fireEvent.click(first);
    expect(setEnabled).toHaveBeenCalledWith('shots', false);
  });

  it('pauses every rule and resumes them', async () => {
    const one = view({ rules: [rule()] });
    const setPaused = vi.spyOn(api, 'automationSetPaused').mockResolvedValue({ ...one, paused: true });
    open(one);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause all' }));
    expect(setPaused).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Paused: no rule watches its folder until you resume.')).toBeTruthy();
    expect(screen.getByText('0 rules on')).toBeTruthy();
    setPaused.mockResolvedValue(one);
    fireEvent.click(screen.getByRole('button', { name: 'Resume all' }));
    expect(setPaused).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByText(/^Paused:/)).toBeNull());
  });

  it('shows what came of each file, newest first, and clears the log', async () => {
    const clear = vi.spyOn(api, 'automationClearActivity').mockResolvedValue(view());
    open(
      view({
        activity: [
          activity(1, 'queued'),
          activity(2, 'done', { outputs: ['C:\\Users\\ayşe\\Pictures\\Optimized\\görüntü 2 🖼️.webp'] }),
          activity(3, 'failed', { message: 'Kento could not read this file.' }),
          activity(4, 'skipped', { message: 'The file is already in this format.' }),
          activity(5, 'cancelled'),
        ],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Recent files' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.activity-badge')?.textContent)).toEqual([
      'Working…',
      'Done',
      'Failed',
      'Skipped',
      'Cancelled',
    ]);
    expect(within(rows[1]!).getByRole('button', { name: 'Show in Explorer' })).toBeTruthy();
    expect(within(rows[2]!).queryByRole('button', { name: 'Show in Explorer' })).toBeNull();
    expect(within(rows[2]!).getByText('Kento could not read this file.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clear).toHaveBeenCalled();
    expect(await screen.findByText('Nothing yet. The files your rules handle are listed here.')).toBeTruthy();
  });

  it('adds a rule from folders chosen in the dialog', async () => {
    const choose = vi
      .spyOn(api, 'automationChooseFolder')
      .mockResolvedValueOnce('C:\\Users\\ayşe\\Pictures\\Screenshots')
      .mockResolvedValueOnce('C:\\Users\\ayşe\\Pictures\\Optimized');
    const save = vi.spyOn(api, 'automationSaveRule').mockResolvedValue(view({ rules: [rule()] }));
    open(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog', { name: 'New rule' });
    const saveButton = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    const [watch, output] = within(dialog).getAllByRole('button', { name: 'Choose folder…' });
    fireEvent.click(watch!);
    expect(await within(dialog).findByText('C:\\Users\\ayşe\\Pictures\\Screenshots')).toBeTruthy();
    fireEvent.click(output!);
    expect(await within(dialog).findByText('C:\\Users\\ayşe\\Pictures\\Optimized')).toBeTruthy();
    expect(choose).toHaveBeenCalledTimes(2);
    fireEvent.change(within(dialog).getByLabelText('Extensions'), { target: { value: 'PNG, .jpg  png' } });
    fireEvent.change(within(dialog).getByLabelText('At least (MB)'), { target: { value: '0,5' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Ekranlar  ' } });
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledWith({
      id: '',
      name: 'Ekranlar',
      enabled: true,
      folder: 'C:\\Users\\ayşe\\Pictures\\Screenshots',
      subfolders: false,
      filter: { extensions: ['png', 'jpg'], pattern: '', minSize: 500_000, maxSize: null },
      action: { kind: 'convert', to: 'webp' },
      output: 'C:\\Users\\ayşe\\Pictures\\Optimized',
    });
    expect(await screen.findByRole('switch', { name: 'Rule: Ekran görüntüleri' })).toBeTruthy();
  });

  it('refuses the watched folder as output and warns for a folder inside it', async () => {
    vi.spyOn(api, 'automationChooseFolder')
      .mockResolvedValueOnce('C:\\Users\\ayşe\\Masaüstü')
      .mockResolvedValueOnce('c:\\users\\AYŞE\\masaüstü\\')
      .mockResolvedValueOnce('C:\\Users\\ayşe\\Masaüstü\\Çıktı');
    open(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    const [watch, output] = within(dialog).getAllByRole('button', { name: 'Choose folder…' });
    fireEvent.click(watch!);
    await within(dialog).findByText('C:\\Users\\ayşe\\Masaüstü');
    fireEvent.click(output!);
    expect(await within(dialog).findByText(/^Choose an output folder outside the watched folder/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(output!);
    expect(await within(dialog).findByText(/^The output folder is inside the watched folder/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a recipe, a tool or moving as the action', async () => {
    vi.spyOn(api, 'automationChooseFolder')
      .mockResolvedValueOnce('/Users/ayşe/İndirilenler')
      .mockResolvedValueOnce('/Users/ayşe/Arşiv');
    const save = vi.spyOn(api, 'automationSaveRule').mockResolvedValue(view());
    open(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    const [watch, output] = within(dialog).getAllByRole('button', { name: 'Choose folder…' });
    fireEvent.click(watch!);
    await within(dialog).findByText('/Users/ayşe/İndirilenler');
    fireEvent.click(output!);
    await within(dialog).findByText('/Users/ayşe/Arşiv');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Recipe' }));
    expect((within(dialog).getByLabelText('Recipe', { selector: 'select' }) as HTMLSelectElement).value).toBe(
      'ready-for-instagram',
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Tool' }));
    const tools = within(dialog).getByLabelText('Tool', { selector: 'select' }) as HTMLSelectElement;
    expect([...tools.options].map((option) => option.text)).toEqual(['Extract archive', 'Remove audio']);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Move' }));
    expect(within(dialog).getByText('Move the files to')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].action).toEqual({ kind: 'move' });
  });

  it('builds a recipe step by step, in the order set', async () => {
    const save = vi
      .spyOn(api, 'recipesSave')
      .mockImplementation(async (recipe) => [INSTAGRAM, { ...recipe, id: 'r2' }]);
    open(view());
    fireEvent.click(await screen.findByRole('button', { name: 'New recipe' }));
    const dialog = screen.getByRole('dialog', { name: 'New recipe' });
    const saveButton = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Web için küçült 🌐' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
    fireEvent.change(within(dialog).getByLabelText('Step 2'), { target: { value: 'convert' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: 'webp' } });
    fireEvent.change(within(dialog).getByLabelText('Longer side (px)'), { target: { value: '0' } });
    expect(saveButton.disabled).toBe(true);
    expect(within(dialog).getByText('Give the recipe a name and check its steps.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Longer side (px)'), { target: { value: '1600' } });
    // The conversion first, then the resize.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move step 2 up' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
    fireEvent.change(within(dialog).getByLabelText('Step 3'), { target: { value: 'compress' } });
    fireEvent.change(within(dialog).getByLabelText('Compress by'), { target: { value: 'size' } });
    fireEvent.change(within(dialog).getByLabelText('Under (MB)'), { target: { value: '1,5' } });
    fireEvent.click(saveButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledWith({
      id: '',
      name: 'Web için küçült 🌐',
      steps: [
        { kind: 'convert', to: 'webp' },
        { kind: 'resize', longSide: 1600 },
        { kind: 'compress', compression: { mode: 'size', bytes: 1_500_000 } },
      ],
    });
    expect(await screen.findByText('Web için küçült 🌐')).toBeTruthy();
    expect(screen.getByText('Convert to WEBP · Resize to 1600 px · Compress under 1.5 MB')).toBeTruthy();
  });

  it('moves and deletes recipes', async () => {
    const second: Recipe = { id: 'r2', name: 'Kare', steps: [{ kind: 'crop', width: 1, height: 1 }] };
    const reorder = vi.spyOn(api, 'recipesReorder').mockResolvedValue([second, INSTAGRAM]);
    const remove = vi.spyOn(api, 'recipesDelete').mockResolvedValue([INSTAGRAM]);
    open(view(), [INSTAGRAM, second]);
    const up = await screen.findByRole('button', { name: 'Move Kare up' });
    expect((screen.getByRole('button', { name: 'Move Ready for Instagram up' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(up);
    expect(reorder).toHaveBeenCalledWith(['r2', 'ready-for-instagram']);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the recipe Kare' }));
    expect(remove).toHaveBeenCalledWith('r2');
    await waitFor(() => expect(screen.queryByText('Kare')).toBeNull());
  });
});

describe('recipe steps in the form', () => {
  it('read back what they were made from', () => {
    for (const step of INSTAGRAM.steps) expect(stepOf(draftOf(step, 'tr'))).toEqual(step);
    expect(draftOf({ kind: 'compress', compression: { mode: 'size', bytes: 1_500_000 } }, 'tr')).toEqual({
      kind: 'compress',
      mode: 'size',
      value: '1,5',
    });
    expect(draftOf({ kind: 'crop', width: 7, height: 3 }, 'en')).toMatchObject({ ratio: 'custom' });
  });

  it('refuse values out of range', () => {
    expect(stepOf({ kind: 'resize', longSide: '70000' })).toBeNull();
    expect(stepOf({ kind: 'crop', ratio: 'custom', width: '0', height: '5' })).toBeNull();
    expect(stepOf({ kind: 'compress', mode: 'ratio', value: '99' })).toBeNull();
    expect(stepOf({ kind: 'compress', mode: 'quality', value: '2.5' })).toBeNull();
    expect(stepOf({ kind: 'convert', to: '' })).toBeNull();
  });
});
