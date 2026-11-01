// SPDX-License-Identifier: MIT
// The default theme: brushed steel, white enamel, black engraving and one tempered-blue accent.
// Values from design/DESIGN.md (section 4).
import { registerTheme, type ThemeDefinition } from './registry';

export const steel: ThemeDefinition = {
  id: 'steel',
  nameKey: 'theme.steel',
  tokens: {
    light: {
      bg: '#f2f3f5',
      surface: '#ffffff',
      'surface-2': '#f5f6f8',
      border: '#dcdfe4',
      'border-strong': '#aab1ba',
      text: '#15181c',
      'text-muted': '#555c67',
      accent: '#2a4ea6',
      'accent-hi': '#3a62c2',
      'on-accent': '#ffffff',
      focus: '#2a4ea6',
      success: '#1c7a4b',
      'on-success': '#ffffff',
      'success-text': '#186a41',
      warning: '#d97706',
      'warning-text': '#15181c',
      danger: '#c2372d',
      shadow: 'rgba(26, 34, 48, 0.14)',
      'steel-hi': '#ffffff',
      'steel-mid': '#c3c8ce',
      'steel-lo': '#7c838c',
      slot: '#1a1e23',
      'scale-tick': 'rgba(85, 92, 103, 0.42)',
    },
    dark: {
      bg: '#16181b',
      surface: '#1f2226',
      'surface-2': '#272b30',
      border: '#32373e',
      'border-strong': '#58606a',
      text: '#eef0f3',
      'text-muted': '#a3abb6',
      accent: '#89a7f5',
      'accent-hi': '#a3bbff',
      'on-accent': '#0a1530',
      focus: '#a3bbff',
      success: '#4fc28c',
      'on-success': '#05231a',
      'success-text': '#71d3a4',
      warning: '#e3a640',
      'warning-text': '#f0bd66',
      danger: '#ff7b70',
      shadow: 'rgba(0, 0, 0, 0.45)',
      'steel-hi': '#c6ccd3',
      'steel-mid': '#6b727b',
      'steel-lo': '#2f343a',
      slot: '#08090b',
      'scale-tick': 'rgba(163, 171, 182, 0.35)',
    },
  },
};

registerTheme(steel);
