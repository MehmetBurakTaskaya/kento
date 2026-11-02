// SPDX-License-Identifier: MIT
// Undo and redo for Mark up: every finished change is one step; a new change after an undo drops
// the steps that were undone.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** How many steps back Ctrl+Z can go. */
export const HISTORY_LIMIT = 200;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function commit<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1]!,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0]!,
    future: history.future.slice(1),
  };
}

export const canUndo = (history: History<unknown>) => history.past.length > 0;
export const canRedo = (history: History<unknown>) => history.future.length > 0;
