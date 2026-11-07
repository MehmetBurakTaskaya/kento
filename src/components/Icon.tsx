// SPDX-License-Identifier: MIT
// Kento's own 24 x 24 stroke icons (design/DESIGN.md, section 5). Directional ones mirror in
// right-to-left layouts through the "flip" class.

/** The screen outline of the window layout icons. */
const SCREEN = 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z';

const PATHS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  library:
    'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v3A1.5 1.5 0 0 1 19.5 10h-15A1.5 1.5 0 0 1 3 8.5zM3 15.5A1.5 1.5 0 0 1 4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM7 7h4M7 17h4',
  // A gear with eight teeth (rays round a circle read as a sun).
  settings:
    'M10.57 5.25L10.77 2.68L13.23 2.68L13.43 5.25A6.9 6.9 0 0 1 15.76 6.21L17.72 4.54L19.46 6.28L17.79 8.24A6.9 6.9 0 0 1 18.75 10.57L21.32 10.77L21.32 13.23L18.75 13.43A6.9 6.9 0 0 1 17.79 15.76L19.46 17.72L17.72 19.46L15.76 17.79A6.9 6.9 0 0 1 13.43 18.75L13.23 21.32L10.77 21.32L10.57 18.75A6.9 6.9 0 0 1 8.24 17.79L6.28 19.46L4.54 17.72L6.21 15.76A6.9 6.9 0 0 1 5.25 13.43L2.68 13.23L2.68 10.77L5.25 10.57A6.9 6.9 0 0 1 6.21 8.24L4.54 6.28L6.28 4.54L8.24 6.21A6.9 6.9 0 0 1 10.57 5.25zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  drop: 'M12 3v11M7.5 9.5L12 14l4.5-4.5M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  link: 'M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1',
  pause: 'M9 5v14M15 5v14',
  play: 'M8 5l11 7-11 7z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  // Wheel slices and their paging; back, restart and move are directional.
  more: 'M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM20 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  back: 'M19 12H5M11 6l-6 6 6 6',
  restart: 'M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5M3.5 3.5v5h5',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  image:
    'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM21 16l-5-5-9 9',
  video: 'M5 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 10l5-3v10l-5-3',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  slides: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 16v4M8 20h8',
  table: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9.5h16M4 15h16M10 9.5V20',
  captions: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 12h4M13 12h4M7 15.5h7M16 15.5h1',
  zip: 'M6 3h12v18H6zM12 3v2M12 7v2M12 11v2M11 14h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 .5-.5z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  shrink: 'M12 3v10M7.5 8.5L12 13l4.5-4.5M5 17h14M8 21h8',
  print: 'M7 9V3h10v6M5 9h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM7 14h10v7H7z',
  grid: 'M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM16.5 3h3A1.5 1.5 0 0 1 21 4.5v3A1.5 1.5 0 0 1 19.5 9h-3A1.5 1.5 0 0 1 15 7.5v-3A1.5 1.5 0 0 1 16.5 3zM16 11h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM4.5 15h3A1.5 1.5 0 0 1 9 16.5v3A1.5 1.5 0 0 1 7.5 21h-3A1.5 1.5 0 0 1 3 19.5v-3A1.5 1.5 0 0 1 4.5 15z',
  compress: 'M4 14h6v6M20 10h-6V4M14 10l6-6M4 20l6-6',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  sliders:
    'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M17 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  pen: 'M16 3l5 5L9 20H4v-5zM13.5 5.5l5 5',
  frame:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8.5 7.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  redact: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 9h10v2H7zM7 13h6v2H7z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 19.5v.5M19.5 14h.5M17 16v2',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM9 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  cutout:
    'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  scissors:
    'M9 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM8.6 8l11.4 9M8.6 16L20 7',
  merge: 'M5 4v4a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V4M12 12v8M8.5 16.5L12 20l3.5-3.5',
  split: 'M12 4v8M5 20v-4a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v4M8.5 7.5L12 4l3.5 3.5',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9.5l5 5M22 9.5l-5 5',
  speed: 'M4 18a8 8 0 1 1 16 0M12 18l4-6M4 18h2M18 18h2',
  share: 'M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  shelf:
    'M3 20h18M3 11h18M5 11v9M19 11v9M8 5h2a1 1 0 0 1 1 1v5H7V6a1 1 0 0 1 1-1zM14 7h2a1 1 0 0 1 1 1v3h-4V8a1 1 0 0 1 1-1z',
  copy: 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3',
  move: 'M3 12h13M12 7l5 5-5 5M20 4v16',
  terminal: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3-3 3M13 15h4',
  // Files, lists and panels.
  pdf: 'M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  'rotate-left': 'M4 9a8 8 0 1 1 1.5 7.5M4 4v5h5',
  'rotate-right': 'M20 9a8 8 0 1 0-1.5 7.5M20 4v5h-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 4l9 15.5H3zM12 10v4.5M12 17.2v.01',
  dial: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v3M3 12h2M19 12h2M12 18v3',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  // Folder automation (a watched folder that acts) and the wheel's Favorites.
  automation: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM13.5 9.5l-3 4h3.5l-3 4',
  star: 'M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.66l5.9-.86z',
  // Media editors.
  'mark-in': 'M10 4H6v16h4M13 12h7M17 9l3 3-3 3',
  'mark-out': 'M14 4h4v16h-4M4 12h7M8 9l3 3-3 3',
  'play-span': 'M4 5v14M20 5v14M9 8.5l6.5 3.5L9 15.5z',
  marker: 'M12 3v18M12 4.5h6l-1.8 3 1.8 3h-6',
  keyboard:
    'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8',
  // Video and audio tools. Time runs left to right in every language, so none of them mirrors.
  vertical:
    'M9.5 2.5h5A2.5 2.5 0 0 1 17 5v14a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 19V5a2.5 2.5 0 0 1 2.5-2.5zM10.5 9.25l4.25 2.75-4.25 2.75z',
  'cut-out':
    'M3.5 6h17A1.5 1.5 0 0 1 22 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 16.5v-9A1.5 1.5 0 0 1 3.5 6zM8 6v12M16 6v12M10 10l4 4M14 10l-4 4',
  pauses: 'M2 10.5v3M4.5 8v8M7 6v12M17 6v12M19.5 8v8M22 10.5v3M9.25 10l1.75 2-1.75 2M14.75 10l-1.75 2 1.75 2',
  'music-plus':
    'M9.25 17.5a2.75 2.75 0 1 1-5.5 0 2.75 2.75 0 0 1 5.5 0zM9.25 17.5V4c2.6.3 4.6 1.8 5.25 4.5M18 13.5v7M14.5 17h7',
  overlay: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 8.5h8M12 8.5V16',
  fade: 'M2.5 18.5L8 6.5h8l5.5 12z',
  denoise: 'M2 12l2-5.5 2.5 11 2.5-8.5 2.5 6 2-3H22',
  loop: 'M17 2.5l3 3-3 3M20 5.5H8a4 4 0 0 0-4 4V11M7 21.5l-3-3 3-3M4 18.5h12a4 4 0 0 0 4-4V13',
  palette:
    'M12 3a9 9 0 0 0 0 18c1.2 0 2-.8 2-1.9 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.1.9-1.8 2-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM8.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM10 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM14.5 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM18 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  'merge-audio': 'M3 6c3 0 5 6 9 6M3 18c3 0 5-6 9-6M12 12c1.25 0 1.5-4.5 3-4.5s1.75 9 3.25 9 1.5-4.5 2.75-4.5',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0M12 3v2',
  stabilize:
    'M7.5 7h9A1.5 1.5 0 0 1 18 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 15.5v-7A1.5 1.5 0 0 1 7.5 7zM3 9v6M21 9v6M12 12h.01',
  // Their quick choices on the wheel.
  'fill-blur':
    'M9.5 2.5h5A2.5 2.5 0 0 1 17 5v14a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 19V5a2.5 2.5 0 0 1 2.5-2.5zM7 9h10M7 15h10M10 5.75h.01M14 5.75h.01M10 18.25h.01M14 18.25h.01',
  'rotate-half': 'M4 14a7.5 7.5 0 0 1 15 0M16.5 11.5l2.5 2.5 2.5-2.5',
  mirror: 'M12 3v3M12 10.5v3M12 18v3M9 7L3 18h6zM15 7l6 11h-6z',
  reverse: 'M11 6.5L4 12l7 5.5zM20 6.5L13 12l7 5.5z',
  boomerang: 'M4 8h15M15.5 4.5L19 8l-3.5 3.5M20 16H5M8.5 12.5L5 16l3.5 3.5',
  'strength-light': 'M4 16a8 8 0 1 1 16 0M12 16l-5.2-3',
  'strength-medium': 'M4 16a8 8 0 1 1 16 0M12 16v-6',
  'strength-strong': 'M4 16a8 8 0 1 1 16 0M12 16l5.2-3',
  contrast: 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM12 3.5v17M12 8h7.5M12 12h8.5M12 16h7.5',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  snowflake:
    'M12 3v18M4.21 7.5l15.58 9M4.21 16.5l15.58-9M10.16 3.76L12 5.6l1.84-1.84M10.16 20.24L12 18.4l1.84 1.84M20.05 9.47l-2.51-.67.67-2.51M3.95 14.53l2.51.67-.67 2.51M18.21 17.71l-.67-2.51 2.51-.67M5.79 6.29l.67 2.51-2.51.67',
  // Window layouts: a screen with the part the window takes. Physical sides, so never mirrored.
  'layout-left-half': `${SCREEN}M5.5 7.5h5v9h-5z`,
  'layout-right-half': `${SCREEN}M13.5 7.5h5v9h-5z`,
  'layout-top-left': `${SCREEN}M5.5 7.5h5v3h-5z`,
  'layout-top-right': `${SCREEN}M13.5 7.5h5v3h-5z`,
  'layout-bottom-left': `${SCREEN}M5.5 13.5h5v3h-5z`,
  'layout-bottom-right': `${SCREEN}M13.5 13.5h5v3h-5z`,
  'layout-center': `${SCREEN}M8.5 9.5h7v5h-7z`,
  'layout-full-screen': `${SCREEN}M5.5 7.5h13v9h-13z`,
} as const;

export type IconName = keyof typeof PATHS;

/** The path data of an icon, or undefined for a name the set does not have. */
export function iconPath(name: string): string | undefined {
  return Object.hasOwn(PATHS, name) ? PATHS[name as IconName] : undefined;
}

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
