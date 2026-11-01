// SPDX-License-Identifier: MIT
// The page's only door to the app core. Inside Kento it calls the Rust commands; in a plain browser
// (vite dev, screenshot tests) it answers from an in-memory stand-in driven by the URL
// (?lang=tr&appearance=dark&section=settings&platform=macos).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export type Appearance = 'system' | 'light' | 'dark';
export type Motion = 'system' | 'on' | 'off';
export type Platform = 'windows' | 'macos' | 'linux';

export interface Settings {
  version: number;
  appearance: Appearance;
  theme: string;
  language: string;
  sound: { enabled: boolean; volume: number };
  haptics: boolean;
  reducedMotion: Motion;
  launchAtLogin: boolean;
  trayIcon: boolean;
  output: { location: 'next-to-source' | 'folder'; folder: string | null };
  concurrency: number | null;
  wheelSize: number;
}

export interface Language {
  code: string;
  name: string;
}

export interface AppInfo {
  name: string;
  version: string;
  website: string;
  repository: string;
  platform: Platform;
  backdrop: 'mica' | 'none';
}

export interface CatalogSummary {
  formats: number;
  coreInputs: number;
  routes: number;
  tools: number;
  actions: number;
  ready: number;
}

interface JobBase {
  id: number;
  title: string;
  lane: 'light' | 'heavy';
}

export type JobInfo = JobBase &
  (
    | { state: 'queued' }
    | { state: 'running'; progress: number | null; etaMs: number | null }
    | { state: 'done'; outputs: string[] }
    | { state: 'failed'; message: string; details: string | null }
    | { state: 'cancelled' }
  );

export interface Bootstrap {
  settings: Settings;
  language: string;
  languages: Language[];
  systemLocale: string | null;
  app: AppInfo;
  catalog: CatalogSummary;
  jobs: JobInfo[];
  paused: boolean;
  defaultJobs: number;
}

export interface Saved {
  settings: Settings;
  language: string;
}

export type Section = 'home' | 'library' | 'settings';

export type Category =
  'image' | 'video' | 'audio' | 'document' | 'spreadsheet' | 'presentation' | 'subtitle' | 'pdf' | 'archive';
export type ToolGroup = 'core' | 'media' | 'office' | 'extras';

/** A file or folder in the Home list. */
export interface FileEntry {
  path: string;
  name: string;
  folder: boolean;
  format: string | null;
  category: Category | null;
  size: number | null;
}

export interface ConvertTarget {
  to: string;
  label: string;
  group: ToolGroup;
  enhancement: boolean;
  note: string | null;
}

/** The Convert wheel's targets for one category of the selection. */
export interface TargetGroup {
  category: Category;
  count: number;
  targets: ConvertTarget[];
}

export interface ToolEntry {
  id: string;
  icon: string;
  group: ToolGroup;
  enhancement: boolean;
}

export interface LibraryEntry {
  id: number;
  path: string;
  folder: boolean;
  format: string | null;
  created: number;
  origin: 'convert' | 'tool' | 'paste';
  source: string | null;
  name: string;
  category: Category | null;
  exists: boolean;
  size: number | null;
}

export type PageSize = 'fit-image' | 'a4' | 'letter';
export interface PageLayout {
  size: PageSize;
  marginMm: number;
}
export type SplitHow = { kind: 'ranges'; ranges: [number, number][] } | { kind: 'every'; pages: number };
export interface PageEdit {
  index: number;
  rotate: number;
}
export interface QrFound {
  file: string;
  page: number | null;
  text: string;
}
export type QrReport = 'txt' | 'csv' | 'json';

export interface Api {
  bootstrap(): Promise<Bootstrap>;
  saveSettings(settings: Settings): Promise<Saved>;
  uiReady(): Promise<void>;
  openLink(which: 'website' | 'repository'): Promise<void>;
  chooseFolder(): Promise<string | null>;
  setJobsPaused(paused: boolean): Promise<void>;
  cancelJob(id: number): Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
  onJob(handler: (job: JobInfo) => void): Promise<UnlistenFn>;
  onPaused(handler: (paused: boolean) => void): Promise<UnlistenFn>;
  onNavigate(handler: (section: Section) => void): Promise<UnlistenFn>;
  onLibrary(handler: () => void): Promise<UnlistenFn>;
  onDrop(handler: (paths: string[]) => void, hover: (over: boolean) => void): Promise<UnlistenFn>;
  inspect(paths: string[]): Promise<FileEntry[]>;
  targets(paths: string[]): Promise<TargetGroup[]>;
  tools(paths: string[]): Promise<ToolEntry[]>;
  convert(paths: string[], to: string): Promise<number[]>;
  pickFiles(): Promise<string[]>;
  pasteFiles(): Promise<string[]>;
  importText(text: string): Promise<FileEntry>;
  importImage(png: Uint8Array): Promise<FileEntry>;
  thumbnail(path: string, size: number): Promise<Blob | null>;
  revealPath(path: string): Promise<void>;
  libraryList(): Promise<LibraryEntry[]>;
  libraryRemove(id: number): Promise<void>;
  libraryReveal(id: number): Promise<void>;
  libraryOpen(id: number): Promise<void>;
  libraryFind(paths: string[]): Promise<LibraryEntry[]>;
  mergePdfs(paths: string[]): Promise<number>;
  splitPdf(path: string, how: SplitHow): Promise<number>;
  editPdf(path: string, pages: PageEdit[]): Promise<number>;
  imagesToPdf(paths: string[], layout: PageLayout): Promise<number>;
  extract(paths: string[]): Promise<number[]>;
  pdfPages(path: string): Promise<number>;
  pdfThumbnail(path: string, index: number, size: number): Promise<Blob | null>;
  scanQr(paths: string[]): Promise<QrFound[]>;
  saveQrReport(found: QrFound[], report: QrReport): Promise<LibraryEntry>;
}

const tauriApi: Api = {
  bootstrap: () => invoke('bootstrap'),
  saveSettings: (settings) => invoke('save_settings', { settings }),
  uiReady: () => invoke('ui_ready'),
  openLink: (which) => invoke('open_link', { which }),
  chooseFolder: () => invoke('choose_folder'),
  setJobsPaused: (paused) => invoke('set_jobs_paused', { paused }),
  cancelJob: (id) => invoke('cancel_job', { id }),
  log: (level, message) => invoke('log_message', { level, message }),
  onJob: (handler) => listen<JobInfo>('job', (event) => handler(event.payload)),
  onPaused: (handler) => listen<boolean>('jobs-paused', (event) => handler(event.payload)),
  onNavigate: (handler) => listen<Section>('navigate', (event) => handler(event.payload)),
  onLibrary: (handler) => listen('library', () => handler()),
  onDrop: (handler, hover) =>
    getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      hover(type === 'enter' || type === 'over');
      if (event.payload.type === 'drop') handler(event.payload.paths);
    }),
  inspect: (paths) => invoke('inspect', { paths }),
  targets: (paths) => invoke('targets', { paths }),
  tools: (paths) => invoke('tools', { paths }),
  convert: (paths, to) => invoke('convert', { paths, to }),
  pickFiles: () => invoke('pick_files'),
  pasteFiles: () => invoke('paste_files'),
  importText: (text) => invoke('import_text', { text }),
  importImage: (png) => invoke('import_image', png),
  thumbnail: (path, size) => blob(invoke<ArrayBuffer>('thumbnail', { path, size })),
  revealPath: (path) => invoke('reveal_path', { path }),
  libraryList: () => invoke('library_list'),
  libraryRemove: (id) => invoke('library_remove', { id }),
  libraryReveal: (id) => invoke('library_reveal', { id }),
  libraryOpen: (id) => invoke('library_open', { id }),
  libraryFind: (paths) => invoke('library_find', { paths }),
  mergePdfs: (paths) => invoke('merge_pdfs', { paths }),
  splitPdf: (path, how) => invoke('split_pdf', { path, how }),
  editPdf: (path, pages) => invoke('edit_pdf', { path, pages }),
  imagesToPdf: (paths, layout) => invoke('images_to_pdf', { paths, layout }),
  extract: (paths) => invoke('extract_archives', { paths }),
  pdfPages: (path) => invoke('pdf_pages', { path }),
  pdfThumbnail: (path, index, size) => blob(invoke<ArrayBuffer>('pdf_thumbnail', { path, index, size })),
  scanQr: (paths) => invoke('scan_qr', { paths }),
  saveQrReport: (found, report) => invoke('save_qr_report', { found, report }),
};

/** PNG bytes from a command as an image Blob; a file without a preview gives null. */
async function blob(bytes: Promise<ArrayBuffer>): Promise<Blob | null> {
  try {
    return new Blob([await bytes], { type: 'image/png' });
  } catch {
    return null;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: 'system',
  theme: 'steel',
  language: 'system',
  sound: { enabled: true, volume: 0.3 },
  haptics: true,
  reducedMotion: 'system',
  launchAtLogin: false,
  trayIcon: true,
  output: { location: 'next-to-source', folder: null },
  concurrency: null,
  wheelSize: 360,
};

/** The browser stand-in: the same answers the core would give, from memory. */
export function browserApi(params: URLSearchParams): Api {
  const languages: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
  ];
  const known = (code: string | null) =>
    code && (languages.some((l) => l.code === code) || code === 'en-XA' || code === 'ar-XB') ? code : null;
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    language: known(params.get('lang')) ?? 'system',
    appearance: (params.get('appearance') as Appearance | null) ?? 'system',
  };
  const resolve = (s: Settings) => (s.language === 'system' ? 'en' : s.language);
  let paused = false;
  const pausedHandlers = new Set<(paused: boolean) => void>();
  const platform = (params.get('platform') as Platform | null) ?? 'windows';
  return {
    bootstrap: async () => ({
      settings,
      language: resolve(settings),
      languages,
      systemLocale: 'en-US',
      app: {
        name: 'Kento',
        version: '0.1.0',
        website: 'https://mehmetburaktaskaya.com',
        repository: 'https://github.com/MehmetBurakTaskaya/kento',
        platform,
        backdrop: 'none',
      },
      catalog: { formats: 56, coreInputs: 46, routes: 0, tools: 31, actions: 8, ready: 0 },
      jobs: [],
      paused,
      defaultJobs: 4,
    }),
    saveSettings: async (next) => {
      settings = next;
      return { settings, language: resolve(settings) };
    },
    uiReady: async () => {},
    openLink: async (which) => {
      window.open(
        which === 'website' ? 'https://mehmetburaktaskaya.com' : 'https://github.com/MehmetBurakTaskaya/kento',
      );
    },
    chooseFolder: async () => (platform === 'macos' ? '/Users/me/Documents/Kento' : 'C:\\Users\\me\\Documents\\Kento'),
    setJobsPaused: async (next) => {
      paused = next;
      pausedHandlers.forEach((handler) => handler(paused));
    },
    cancelJob: async () => {},
    log: async (level, message) => console[level](message),
    onJob: async () => () => {},
    onPaused: async (handler) => {
      pausedHandlers.add(handler);
      return () => pausedHandlers.delete(handler);
    },
    onNavigate: async () => () => {},
    onLibrary: async () => () => {},
    onDrop: async () => () => {},
    inspect: async (paths) => paths.map(demoEntry),
    targets: async (paths) => {
      const groups = new Map<Category, number>();
      for (const entry of paths.map(demoEntry)) {
        if (entry.category) groups.set(entry.category, (groups.get(entry.category) ?? 0) + 1);
      }
      return [...groups].map(([category, count]) => ({
        category,
        count,
        targets: (DEMO_TARGETS[category] ?? []).map((to) => ({
          to,
          label: to === 'tar-gz' ? 'TAR.GZ' : to.toUpperCase(),
          group: 'core' as const,
          enhancement: to === 'ico' || to === '7z',
          note: null,
        })),
      }));
    },
    tools: async (paths) => {
      const categories = new Set(paths.map((path) => demoEntry(path).category));
      const only = (category: Category) => categories.size === 1 && categories.has(category);
      const ids = [
        ...(only('pdf') && paths.length === 1 ? ['split-pdf', 'edit-pdf'] : []),
        ...(only('pdf') && paths.length > 1 ? ['merge-pdf'] : []),
        ...(only('image') ? ['images-to-pdf'] : []),
        ...([...categories].every((c) => c === 'image' || c === 'pdf') ? ['read-qr'] : []),
        ...(only('archive') ? ['extract'] : []),
      ];
      return ids.map((id) => ({ id, icon: 'doc', group: 'core' as const, enhancement: false }));
    },
    convert: async (paths) => paths.map((_, index) => index + 1),
    pickFiles: async () => DEMO_FILES,
    pasteFiles: async () => [],
    importText: async () => demoEntry('Pasted text.txt'),
    importImage: async () => demoEntry('Pasted image.png'),
    thumbnail: async () => null,
    revealPath: async () => {},
    libraryList: async () => (params.get('library') === 'demo' ? DEMO_LIBRARY : []),
    libraryRemove: async () => {},
    libraryReveal: async () => {},
    libraryOpen: async () => {},
    libraryFind: async () => [],
    mergePdfs: async () => 1,
    splitPdf: async () => 1,
    editPdf: async () => 1,
    imagesToPdf: async () => 1,
    extract: async (paths) => paths.map((_, index) => index + 1),
    pdfPages: async () => 6,
    pdfThumbnail: async () => null,
    scanQr: async (paths) => paths.map((file) => ({ file, page: null, text: 'https://mehmetburaktaskaya.com' })),
    saveQrReport: async () => DEMO_LIBRARY[0]!,
  };
}

const DEMO_FILES = ['C:\\Users\\me\\Pictures\\Kapadokya 🎈.heic', 'C:\\Users\\me\\Documents\\Rapor 2026.pdf'];

const DEMO_FORMATS: Record<string, [string, Category]> = {
  heic: ['heic', 'image'],
  jpg: ['jpg', 'image'],
  jpeg: ['jpg', 'image'],
  png: ['png', 'image'],
  webp: ['webp', 'image'],
  pdf: ['pdf', 'pdf'],
  zip: ['zip', 'archive'],
  txt: ['txt', 'document'],
  md: ['md', 'document'],
  csv: ['csv', 'spreadsheet'],
  xlsx: ['xlsx', 'spreadsheet'],
  srt: ['srt', 'subtitle'],
};

const DEMO_TARGETS: Partial<Record<Category, string[]>> = {
  image: ['jpg', 'png', 'webp', 'avif', 'pdf', 'tiff', 'gif', 'bmp', 'ico'],
  pdf: ['jpg', 'png', 'txt', 'md'],
  archive: ['zip', 'tar', 'tar-gz', '7z'],
  document: ['txt', 'md', 'html'],
  spreadsheet: ['csv', 'tsv', 'xlsx', 'html'],
  subtitle: ['srt', 'vtt', 'txt'],
};

function demoEntry(path: string): FileEntry {
  const name = path.split(/[\\/]/).pop() ?? path;
  const known = DEMO_FORMATS[name.split('.').pop()?.toLowerCase() ?? ''];
  return {
    path,
    name,
    folder: false,
    format: known?.[0] ?? null,
    category: known?.[1] ?? null,
    size: 1_234_567 + name.length * 4_321,
  };
}

const DEMO_LIBRARY: LibraryEntry[] = [
  demoItem(3, 'C:\\Users\\me\\Pictures\\Kapadokya 🎈.jpg', 'convert', 'Kapadokya 🎈.heic', 60_000),
  demoItem(2, 'C:\\Users\\me\\Documents\\Rapor 2026 - merged.pdf', 'tool', 'Rapor 2026.pdf', 3_600_000),
  { ...demoItem(1, 'C:\\Users\\me\\Downloads\\Kento\\Pasted text.txt', 'paste', null, 86_400_000), exists: false },
];

function demoItem(
  id: number,
  path: string,
  origin: LibraryEntry['origin'],
  source: string | null,
  age: number,
): LibraryEntry {
  return { id, ...demoEntry(path), created: Date.now() - age, origin, source, exists: true };
}

export const api: Api = isTauri() ? tauriApi : browserApi(new URLSearchParams(window.location.search));
