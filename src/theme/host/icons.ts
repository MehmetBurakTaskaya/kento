// SPDX-License-Identifier: MIT
// The 24 x 24 stroke icons a theme's wheel draws with H.icon(). Themes were drawn with this set and may
// override any of its names; the app's own icon names map onto it, and an app icon the set lacks is
// drawn from the app's own paths, so every slice has its icon in every theme.
import { iconPath, type IconName } from '../../components/Icon';

export const ICONS: Record<string, string> = {
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  shrink: '<path d="M12 3v10M7.5 8.5L12 13l4.5-4.5M5 17h14M8 21h8"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  grid: '<rect x="3" y="3" width="10" height="10" rx="2"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="11" width="4" height="4" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1.5"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l6-6M4 20l6-6"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  sliders:
    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  pen: '<path d="M16 3l5 5L9 20H4v-5z"/><path d="M13.5 5.5l5 5"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/>',
  redact: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6" stroke-width="3"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 19.5v.5M19.5 14h.5M17 16v2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  cutout:
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2.6 2.6"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  shelf:
    '<path d="M3 20h18M3 11h18M5 11v9M19 11v9"/><rect x="7" y="5" width="4" height="6" rx="1"/><rect x="13" y="7" width="4" height="4" rx="1"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  move: '<path d="M3 12h13M12 7l5 5-5 5M20 4v16"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  zip: '<path d="M6 3h12v18H6z"/><path d="M12 3v2M12 7v2M12 11v2"/><rect x="10.5" y="14" width="3" height="3" rx=".5"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  library:
    '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h4M7 17h4"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  tray: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M9 3h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 14v7"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
};

/** App icon names whose counterpart in the set has another name. */
const ALIASES: Partial<Record<IconName, string>> = {
  settings: 'gear',
  drop: 'tray',
  alert: 'warning',
  pdf: 'doc',
};

/** The markup of an icon by the app's name (or the set's own): the theme's override first, then the
 *  set, then the app's own drawing, then a plain file. */
export function iconMarkup(name: string, overrides?: Record<string, string>): string {
  const own = ALIASES[name as IconName] ?? name;
  const drawn = overrides?.[own] ?? overrides?.[name] ?? ICONS[own];
  if (drawn) return drawn;
  const path = iconPath(name);
  return path ? `<path d="${path}"/>` : ICONS.file!;
}
