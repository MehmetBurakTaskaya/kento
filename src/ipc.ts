// SPDX-License-Identifier: MIT
// The page's only door to the app core. Inside Kento it calls the Rust commands; in a plain browser
// (vite dev, screenshot tests) it answers from an in-memory stand-in driven by the URL
// (?lang=tr&appearance=dark&section=settings&platform=macos).
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
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
  wheels: {
    global: boolean;
    convert: WheelKey;
    tools: WheelKey;
    actions: WheelKey;
    selectionShortcut: boolean;
  };
  shell: { sendTo: boolean; contextMenu: boolean };
  shelf: { keepCopy: boolean };
}

export type WheelKey = 'shift' | 'control' | 'alt' | 'command';

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
  /** The tool group to install first. */
  needs: ToolGroup | null;
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
  /** The tool group to install first. */
  needs: ToolGroup | null;
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

export interface ActionEntry {
  id: string;
  icon: string;
}

export type WheelKind = 'convert' | 'tools' | 'actions';

/** What the floating wheel shows; paths are known up front only without a drag. */
export interface WheelSession {
  id: number;
  kind: WheelKind;
  mode: 'drag' | 'click';
  paths: string[];
}

/** A system drag over a window: positions in CSS pixels of that window. */
export type DragOver =
  | { type: 'enter'; paths: string[]; x: number; y: number }
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; paths: string[]; x: number; y: number }
  | { type: 'leave' };

export type CornerCard =
  | { kind: 'done'; id: number; title: string; outputs: string[] }
  | { kind: 'failed'; id: number; title: string; message: string; details: string | null }
  | { kind: 'info'; id: number; message: string };

export interface ShelfItem {
  id: number;
  path: string;
  name: string;
  added: number;
  copy: boolean;
  present: boolean;
  category: Category | null;
}

/** What ffprobe says about a video or audio file. */
export interface MediaInfo {
  duration: number;
  video: { width: number; height: number; fps: number; codec: string; pixelFormat?: string } | null;
  audio: { channels: number; sampleRate: number; codec: string } | null;
}

/** A URL the page can play: the original, or a low-resolution proxy for codecs the WebView lacks. */
export interface MediaPreview {
  url: string;
  proxy: boolean;
}

export interface Span {
  start: number;
  end: number;
}
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Hide = { kind: 'color'; rgb: [number, number, number] } | { kind: 'blur' } | { kind: 'pixelate' };

/** The 13 media tools and their choices (SPEC 5.5); times in seconds, areas in video pixels. */
export type MediaTool =
  | { tool: 'mute' }
  | { tool: 'trim-video'; span: Span }
  | { tool: 'crop-video'; area: Area }
  | { tool: 'speed'; factor: number }
  | { tool: 'merge-video' }
  | { tool: 'frames'; at: number[] }
  | {
      tool: 'split-video';
      at: { kind: 'markers'; at: number[] } | { kind: 'parts'; count: number } | { kind: 'every'; seconds: number };
      keep: boolean[] | null;
    }
  | { tool: 'redact-video'; areas: { area: Area; span: Span }[]; hide: Hide }
  | { tool: 'normalize'; loudness: { target: number; range: number; peak: number } }
  | { tool: 'trim-audio'; span: Span; removeSilence: boolean }
  | {
      tool: 'channels';
      channels: { kind: 'mono' } | { kind: 'stereo' } | { kind: 'levels'; left: number; right: number };
    }
  | { tool: 'redact-audio'; spans: Span[]; beep: boolean }
  | {
      tool: 'audio-to-video';
      visual: { kind: 'waveform' } | { kind: 'spectrum' } | { kind: 'bars' } | { kind: 'image'; path: string };
    };

/** A picture's upright size in pixels (after its EXIF orientation). */
export interface ImageInfo {
  width: number;
  height: number;
}

/** Red, green, blue and alpha, 0 to 255. */
export type Rgba = [number, number, number, number];
export type Rgb = [number, number, number];
export type Point = [number, number];

/** Edit image: turn, flip, resize, then the colour adjustments (-100 to 100, 0 = unchanged). */
export interface Adjust {
  turn: 'none' | 'right' | 'half' | 'left';
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** Width and height after turning; null keeps the size. */
  resize: [number, number] | null;
  brightness: number;
  contrast: number;
  saturation: number;
}

/** One mark of Mark up; points, widths and sizes in source pixels. */
export type Mark =
  | { kind: 'pen'; points: Point[]; color: Rgba; width: number }
  | { kind: 'highlighter'; points: Point[]; color: Rgba; width: number }
  | { kind: 'rectangle'; area: Area; color: Rgba; width: number; filled: boolean }
  | { kind: 'ellipse'; area: Area; color: Rgba; width: number; filled: boolean }
  | { kind: 'line'; from: Point; to: Point; color: Rgba; width: number }
  | { kind: 'arrow'; from: Point; to: Point; color: Rgba; width: number }
  | { kind: 'text'; at: Point; text: string; color: Rgba; size: number };

export type FrameBackground =
  | { kind: 'color'; rgb: Rgb }
  /** angle in degrees: 0 runs left to right, 90 top to bottom. */
  | { kind: 'gradient'; from: Rgb; to: Rgb; angle: number }
  | { kind: 'blurred' };

export interface FrameStyle {
  /** Space around the picture, in source pixels. */
  padding: number;
  background: FrameBackground;
  radius: number;
  shadow: boolean;
}

export interface CollageStyle {
  layout: { kind: 'grid'; columns: number } | { kind: 'row' } | { kind: 'column' };
  /** Between the cells and around the edge, in pixels of the result. */
  spacing: number;
  background: Rgb;
  /** The result's width in pixels. */
  width: number;
  /** true: each picture fills its cell (cropped); false: it fits whole. */
  fill: boolean;
}

/** The six image editors and their choices (SPEC 5.5); areas in source pixels. */
export type ImageTool =
  | { tool: 'edit-image'; adjust: Adjust }
  | { tool: 'crop-image'; area: Area }
  | { tool: 'markup'; marks: Mark[] }
  | { tool: 'frame'; frame: FrameStyle }
  | { tool: 'collage'; collage: CollageStyle }
  | { tool: 'redact-image'; areas: Area[]; hide: Hide };

/** Compress: a quality level (1–100), a share of the original size (5–95 %), or a size limit. */
export type Compression =
  { mode: 'quality'; level: number } | { mode: 'ratio'; percent: number } | { mode: 'size'; bytes: number };

export interface MetadataField {
  /** What MetadataChange.set names. */
  key: string;
  /** The family it belongs to (EXIF, XMP, PDF, Format…), shown as a heading. */
  group: string;
  /** The tag's own name, shown as it is. */
  name: string;
  value: string;
  editable: boolean;
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface MetadataInfo {
  fields: MetadataField[];
  /** Video and audio only. */
  chapters: Chapter[];
  hasLocation: boolean;
}

export interface MetadataChange {
  /** Editable keys and new values; an empty value removes the field. */
  set: Record<string, string>;
  removeAll: boolean;
  removeLocation: boolean;
  /** Video and audio: the new chapters; null keeps them. */
  chapters: Chapter[] | null;
}

/** An optional tool group (SPEC 4.2) and where it stands on this computer. */
export interface ToolGroupStatus {
  id: 'media' | 'office' | 'extras';
  /** Ready to use: found on the system or installed by Kento. */
  ready: boolean;
  /** Where each tool was found, when it was. */
  tools: { id: string; path: string | null; version: string | null; source: 'system' | 'kento' | 'custom' | null }[];
  /** Bytes to download for this computer; 0 when nothing is offered yet. */
  download: number;
  available: boolean;
  /** A tool in use comes from an earlier Kento download than the one this version pins. */
  outdated: boolean;
  /** Kento's own downloads of this group are on disk. */
  downloaded: boolean;
}

export type InstallProgress =
  | { group: string; state: 'downloading'; done: number; total: number }
  | { group: string; state: 'verifying' | 'unpacking' }
  | { group: string; state: 'ready' }
  | { group: string; state: 'failed'; message: string };

export interface ShelfView {
  items: ShelfItem[];
  history: ShelfItem[];
}

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
  actions(): Promise<ActionEntry[]>;
  runAction(action: string, paths: string[]): Promise<number[]>;
  openTool(tool: string, paths: string[]): Promise<void>;
  takePendingTool(): Promise<[string, string[]] | null>;
  onOpenTool(handler: (tool: string, paths: string[]) => void): Promise<UnlistenFn>;
  onDragOver(handler: (event: DragOver) => void): Promise<UnlistenFn>;
  wheelSession(): Promise<WheelSession | null>;
  wheelDropped(): Promise<void>;
  wheelSwitch(kind: WheelKind): Promise<void>;
  wheelClosed(): Promise<void>;
  onWheelOpen(handler: (session: WheelSession) => void): Promise<UnlistenFn>;
  onWheelClose(handler: () => void): Promise<UnlistenFn>;
  toastCards(): Promise<CornerCard[]>;
  toastLayout(height: number): Promise<void>;
  toastDismiss(id: number): Promise<void>;
  onToast(handler: (card: CornerCard) => void): Promise<UnlistenFn>;
  shelfView(): Promise<ShelfView>;
  shelfAdd(paths: string[]): Promise<void>;
  shelfRemove(id: number): Promise<void>;
  shelfClear(): Promise<void>;
  shelfHide(): Promise<void>;
  shelfReveal(id: number): Promise<void>;
  shelfToWheel(ids: number[]): Promise<void>;
  shelfDrag(ids: number[]): Promise<void>;
  onShelf(handler: () => void): Promise<UnlistenFn>;
  onSettings(handler: (saved: Saved) => void): Promise<UnlistenFn>;
  haptic(): Promise<void>;
  openSetup(): Promise<void>;
  onOpenSetup(handler: () => void): Promise<UnlistenFn>;
  mediaProbe(path: string): Promise<MediaInfo>;
  mediaPreview(path: string): Promise<MediaPreview>;
  mediaPeaks(path: string, buckets: number): Promise<number[]>;
  mediaFrame(path: string, at: number, size: number): Promise<Blob | null>;
  runMediaTool(tool: MediaTool, paths: string[]): Promise<number[]>;
  imageInfo(path: string): Promise<ImageInfo>;
  /** A PNG of the tool applied (or of the picture itself), at most `size` px on its longer side. */
  imagePreview(paths: string[], tool: ImageTool | null, size: number): Promise<Blob | null>;
  runImageTool(tool: ImageTool, paths: string[]): Promise<number[]>;
  runCompress(compression: Compression, paths: string[]): Promise<number[]>;
  metadataRead(path: string): Promise<MetadataInfo>;
  runMetadata(path: string, change: MetadataChange): Promise<number[]>;
  toolsStatus(): Promise<ToolGroupStatus[]>;
  toolsInstall(group: string): Promise<void>;
  toolsCancel(group: string): Promise<void>;
  /** Looks for every tool again. */
  toolsRefresh(): Promise<ToolGroupStatus[]>;
  /** Deletes Kento's own downloads of a group; tools elsewhere stay. */
  toolsRemove(group: string): Promise<ToolGroupStatus[]>;
  /** The system's file dialog picks the program; null when it was closed. */
  toolsChoose(tool: string): Promise<ToolGroupStatus[] | null>;
  /** Forgets a chosen program and finds the tool by itself again. */
  toolsClearPath(tool: string): Promise<ToolGroupStatus[]>;
  onToolsProgress(handler: (progress: InstallProgress) => void): Promise<UnlistenFn>;
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
  actions: () => invoke('actions'),
  runAction: (action, paths) => invoke('run_action', { action, paths }),
  openTool: (tool, paths) => invoke('open_tool', { tool, paths }),
  takePendingTool: () => invoke('take_pending_tool'),
  onOpenTool: (handler) =>
    listen<[string, string[]]>('open-tool', (event) => handler(event.payload[0], event.payload[1])),
  onDragOver: (handler) =>
    getCurrentWebview().onDragDropEvent((event) => {
      const scale = window.devicePixelRatio || 1;
      const payload = event.payload;
      if (payload.type === 'leave') return handler({ type: 'leave' });
      const x = payload.position.x / scale;
      const y = payload.position.y / scale;
      if (payload.type === 'enter') handler({ type: 'enter', paths: payload.paths, x, y });
      else if (payload.type === 'over') handler({ type: 'over', x, y });
      else handler({ type: 'drop', paths: payload.paths, x, y });
    }),
  wheelSession: () => invoke('wheel_session'),
  wheelDropped: () => invoke('wheel_dropped'),
  wheelSwitch: (kind) => invoke('wheel_switch', { kind }),
  wheelClosed: () => invoke('wheel_closed'),
  onWheelOpen: (handler) => listen<WheelSession>('wheel-open', (event) => handler(event.payload)),
  onWheelClose: (handler) => listen('wheel-close', () => handler()),
  toastCards: () => invoke('toast_cards'),
  toastLayout: (height) => invoke('toast_layout', { height }),
  toastDismiss: (id) => invoke('toast_dismiss', { id }),
  onToast: (handler) => listen<CornerCard>('toast', (event) => handler(event.payload)),
  shelfView: () => invoke('shelf_view'),
  shelfAdd: (paths) => invoke('shelf_add', { paths }),
  shelfRemove: (id) => invoke('shelf_remove', { id }),
  shelfClear: () => invoke('shelf_clear'),
  shelfHide: () => invoke('shelf_hide'),
  shelfReveal: (id) => invoke('shelf_reveal', { id }),
  shelfToWheel: (ids) => invoke('shelf_to_wheel', { ids }),
  shelfDrag: (ids) => invoke('shelf_drag', { ids }),
  onShelf: (handler) => listen('shelf', () => handler()),
  onSettings: (handler) => listen<Saved>('settings', (event) => handler(event.payload)),
  haptic: () => invoke('wheel_haptic'),
  openSetup: () => invoke('open_setup'),
  onOpenSetup: (handler) => listen('open-setup', () => handler()),
  mediaProbe: (path) => invoke('media_probe', { path }),
  mediaPreview: (path) =>
    invoke<{ path: string; proxy: boolean }>('media_preview', { path }).then((preview) => ({
      url: convertFileSrc(preview.path),
      proxy: preview.proxy,
    })),
  mediaPeaks: (path, buckets) => invoke('media_peaks', { path, buckets }),
  mediaFrame: (path, at, size) => blob(invoke<ArrayBuffer>('media_frame', { path, at, size })),
  runMediaTool: (tool, paths) => invoke('run_media_tool', { tool, paths }),
  imageInfo: (path) => invoke('image_info', { path }),
  imagePreview: (paths, tool, size) => blob(invoke<ArrayBuffer>('image_preview', { paths, tool, size })),
  runImageTool: (tool, paths) => invoke('run_image_tool', { tool, paths }),
  runCompress: (compression, paths) => invoke('run_compress', { compression, paths }),
  metadataRead: (path) => invoke('metadata_read', { path }),
  runMetadata: (path, change) => invoke('run_metadata', { path, change }),
  toolsStatus: () => invoke('tools_status'),
  toolsInstall: (group) => invoke('tools_install', { group }),
  toolsCancel: (group) => invoke('tools_cancel', { group }),
  toolsRefresh: () => invoke('tools_refresh'),
  toolsRemove: (group) => invoke('tools_remove', { group }),
  toolsChoose: (tool) => invoke('tools_choose', { tool }),
  toolsClearPath: (tool) => invoke('tools_clear_path', { tool }),
  onToolsProgress: (handler) => listen<InstallProgress>('tools-progress', (event) => handler(event.payload)),
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
  wheels: { global: true, convert: 'shift', tools: 'control', actions: 'alt', selectionShortcut: true },
  shell: { sendTo: false, contextMenu: false },
  shelf: { keepCopy: false },
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
          needs: null,
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
      return ids.map((id) => ({ id, icon: 'doc', group: 'core' as const, enhancement: false, needs: null }));
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
    actions: async () =>
      ['share', 'shelf', 'copy', 'move', 'copy-path', 'terminal', 'reveal', 'zip'].map((id) => ({ id, icon: id })),
    runAction: async () => [],
    openTool: async () => {},
    takePendingTool: async () => null,
    onOpenTool: async () => () => {},
    onDragOver: async () => () => {},
    // ?surface=wheel&wheel=convert shows the floating wheel for the demo files.
    wheelSession: async () => {
      const kind = params.get('wheel') as WheelKind | null;
      return kind ? { id: 1, kind, mode: 'click', paths: DEMO_FILES } : null;
    },
    wheelDropped: async () => {},
    wheelSwitch: async () => {},
    wheelClosed: async () => {},
    onWheelOpen: async () => () => {},
    onWheelClose: async () => () => {},
    toastCards: async () =>
      params.get('surface') === 'toast'
        ? [
            { kind: 'done', id: 1, title: 'Kapadokya 🎈.heic → JPG', outputs: [DEMO_LIBRARY[0]!.path] },
            {
              kind: 'failed',
              id: 2,
              title: 'Rapor 2026.pdf → PNG',
              message: 'This file is password protected.',
              details: 'encrypted',
            },
          ]
        : [],
    toastLayout: async () => {},
    toastDismiss: async () => {},
    onToast: async () => () => {},
    shelfView: async () => ({
      items: DEMO_FILES.map((path, index) => ({
        ...demoEntry(path),
        id: index + 1,
        added: Date.now(),
        copy: false,
        present: true,
      })),
      history: [
        {
          ...demoEntry('C:\\Users\\me\\Desktop\\eski not.txt'),
          id: 9,
          added: Date.now() - 86_400_000,
          copy: false,
          present: false,
        },
      ],
    }),
    shelfAdd: async () => {},
    shelfRemove: async () => {},
    shelfClear: async () => {},
    shelfHide: async () => {},
    shelfReveal: async () => {},
    shelfToWheel: async () => {},
    shelfDrag: async () => {},
    onShelf: async () => () => {},
    onSettings: async () => () => {},
    haptic: async () => {},
    openSetup: async () => {},
    onOpenSetup: async () => () => {},
    mediaProbe: async (path) =>
      /\.(mp3|wav|m4a|flac|ogg|opus|aiff|wma)$/i.test(path)
        ? { duration: 184.2, video: null, audio: { channels: 2, sampleRate: 44100, codec: 'mp3' } }
        : {
            duration: 95.4,
            video: { width: 1920, height: 1080, fps: 30, codec: 'h264' },
            audio: { channels: 2, sampleRate: 48000, codec: 'aac' },
          },
    mediaPreview: async () => ({ url: '', proxy: false }),
    mediaPeaks: async (_path, buckets) =>
      Array.from({ length: buckets }, (_, i) => Math.abs(Math.sin(i / 9)) * (0.4 + 0.6 * Math.abs(Math.cos(i / 41)))),
    mediaFrame: async () => null,
    runMediaTool: async () => [1],
    imageInfo: async () => ({ width: 4032, height: 3024 }),
    imagePreview: async () => null,
    runImageTool: async () => [1],
    runCompress: async (_compression, paths) => paths.map((_, i) => i + 1),
    metadataRead: async () => ({ fields: [], chapters: [], hasLocation: false }),
    runMetadata: async () => [1],
    toolsStatus: async () => demoTools(params.get('tools') === 'ready'),
    toolsInstall: async () => {},
    toolsCancel: async () => {},
    toolsRefresh: async () => demoTools(params.get('tools') === 'ready'),
    toolsRemove: async () => demoTools(false),
    toolsChoose: async () => null,
    toolsClearPath: async () => demoTools(params.get('tools') === 'ready'),
    onToolsProgress: async () => () => {},
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

function demoTools(ready: boolean): ToolGroupStatus[] {
  const found = (id: string) => ({
    id,
    path: ready ? `C:\\Users\\me\\AppData\\Local\\Kento\\tools\\media\\9.0.2\\${id}.exe` : null,
    version: ready ? '9.0.2-essentials_build-www.gyan.dev' : null,
    source: ready ? ('kento' as const) : null,
  });
  return [
    {
      id: 'media',
      ready,
      tools: [found('ffmpeg'), found('ffprobe')],
      download: 92_000_000,
      available: true,
      outdated: false,
      downloaded: ready,
    },
    { id: 'office', ready: false, tools: [], download: 0, available: false, outdated: false, downloaded: false },
    { id: 'extras', ready: false, tools: [], download: 0, available: false, outdated: false, downloaded: false },
  ];
}

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
