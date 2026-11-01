// SPDX-License-Identifier: MIT
// The wheel component, and its demo page for development builds (`?wheel-demo=1` on the dev server).
import { lazy, type ComponentType } from 'react';

export { Wheel, type WheelProps, type WheelSlice } from './Wheel';

/** True on the dev server when the URL asks for the wheel demo. */
export function wheelDemoRequested(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('wheel-demo');
}

// The demo stays out of release builds: there the import below is never reached and Vite drops it.
export const WheelDemo: ComponentType = import.meta.env.DEV ? lazy(() => import('./demo')) : () => null;
