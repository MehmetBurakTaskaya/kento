// SPDX-License-Identifier: MIT
// The current time to the minute, for "5 minutes ago"; it ticks while something shows it.
import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;

function subscribe(tick: () => void) {
  const timer = setInterval(tick, MINUTE / 2);
  return () => clearInterval(timer);
}

// Rounded so that React sees the same value until the minute changes.
const snapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot);
}
