// SPDX-License-Identifier: MIT
// The shared keyboard layout of the media editors (SPEC 5.6). Timelines run left to right in every
// language, so ← is always back in time.

export type EditorAction =
  | { type: 'toggle' }
  | { type: 'step'; seconds: number }
  | { type: 'in' }
  | { type: 'out' }
  | { type: 'play-selection' }
  | { type: 'marker' }
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'save' }
  | { type: 'close' };

export interface KeyInput {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

// The Turkish layouts give ı and İ on the I key; both count.
const IN_KEYS = new Set(['i', 'I', 'ı', 'İ']);
const OUT_KEYS = new Set(['o', 'O']);
const MARKER_KEYS = new Set(['m', 'M']);

/** What a key press does in an editor; `fine` is one frame for video, 0.1 s for audio. */
export function editorKey(event: KeyInput, mac: boolean, fine: number): EditorAction | null {
  const command = mac ? event.metaKey : event.ctrlKey;
  // Ctrl+S / ⌘S, also on layouts where that key types another letter.
  if (command && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 's' || event.code === 'KeyS')) {
    return { type: 'save' };
  }
  if (event.key === 'Escape') return { type: 'close' };
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const shift = event.shiftKey;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return shift ? { type: 'play-selection' } : { type: 'toggle' };
    case 'ArrowLeft':
      return { type: 'step', seconds: shift ? -fine : -1 };
    case 'ArrowRight':
      return { type: 'step', seconds: shift ? fine : 1 };
    case 'Home':
      return shift ? null : { type: 'start' };
    case 'End':
      return shift ? null : { type: 'end' };
  }
  if (IN_KEYS.has(event.key)) return { type: 'in' };
  if (OUT_KEYS.has(event.key)) return { type: 'out' };
  if (MARKER_KEYS.has(event.key)) return { type: 'marker' };
  return null;
}

/**
 * How much of the layout a focused element leaves to the editor: none while typing in a field
 * (only save and close), everything but plain Space on buttons and check boxes, which they use to
 * activate. Shift+Space still plays the selection there instead of pressing the button.
 */
export function keyScope(target: EventTarget | null): 'all' | 'no-activation' | 'commands' {
  if (!(target instanceof Element)) return 'all';
  // Radio buttons and range sliders use the arrows themselves.
  if (target.closest('input:not([type="checkbox"]):not([type="button"]), select, textarea')) {
    return 'commands';
  }
  if ((target as HTMLElement).isContentEditable) return 'commands';
  if (target.closest('button, a[href], summary, input, [role="button"], [role="radio"], [role="checkbox"]')) {
    return 'no-activation';
  }
  return 'all';
}

/** Whether an action may run with the focus in that scope. */
export function allowed(action: EditorAction, scope: ReturnType<typeof keyScope>): boolean {
  if (action.type === 'save' || action.type === 'close') return true;
  if (scope === 'commands') return false;
  if (scope === 'no-activation') return action.type !== 'toggle';
  return true;
}
