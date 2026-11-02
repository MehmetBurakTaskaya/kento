// SPDX-License-Identifier: MIT
// The keys of the image editors: Ctrl+S / ⌘S saves (Enter too in Crop image), Ctrl+Z and Ctrl+Y
// (or Ctrl+Shift+Z) undo and redo in Mark up, Delete removes, the arrows move the chosen area or
// mark, and Ctrl with +, - or 0 zooms. Esc closes through the dialog.
import type { KeyInput } from '../keys';

export type ImageAction =
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'remove' }
  | { type: 'enter' }
  | { type: 'zoom'; by: 1 | -1 | 0 }
  | { type: 'nudge'; x: -1 | 0 | 1; y: -1 | 0 | 1; fine: boolean };

const CODE_LETTER = /^Key([A-Z])$/;

/** The letter of a shortcut: the one typed, or on a layout without Latin letters, the key's place. */
function letter(event: KeyInput): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  return CODE_LETTER.exec(event.code ?? '')?.[1]?.toLowerCase() ?? '';
}

const ARROWS: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function imageKey(event: KeyInput, mac: boolean): ImageAction | null {
  const command = mac ? event.metaKey : event.ctrlKey;
  if (command && !event.altKey) {
    const key = letter(event);
    if (key === 's' && !event.shiftKey) return { type: 'save' };
    if (key === 'z') return { type: event.shiftKey ? 'redo' : 'undo' };
    if (key === 'y' && !event.shiftKey) return { type: 'redo' };
    if (event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd') {
      return { type: 'zoom', by: 1 };
    }
    if (event.key === '-' || event.code === 'Minus' || event.code === 'NumpadSubtract') return { type: 'zoom', by: -1 };
    if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') return { type: 'zoom', by: 0 };
    return null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Delete' || event.key === 'Backspace') return { type: 'remove' };
  if (event.key === 'Enter' && !event.shiftKey) return { type: 'enter' };
  const arrow = ARROWS[event.key];
  if (arrow) return { type: 'nudge', x: arrow[0], y: arrow[1], fine: event.shiftKey };
  return null;
}

/**
 * Whether an action may run where the focus is (scopes from `keyScope`): only saving while typing
 * in a field; on buttons and other controls, everything but Enter and the arrows, which they use
 * themselves. The picture is not such a control, so Enter and the arrows work there.
 */
export function imageAllowed(action: ImageAction, scope: 'all' | 'no-activation' | 'commands', onPicture: boolean) {
  if (action.type === 'save') return true;
  if (scope === 'commands') return false;
  if (scope === 'no-activation' && !onPicture) return action.type !== 'enter' && action.type !== 'nudge';
  return true;
}
