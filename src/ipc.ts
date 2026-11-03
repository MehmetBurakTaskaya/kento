// SPDX-License-Identifier: MIT
// The page's only door to the app core. Inside Kento it calls the Rust commands; in a plain browser
// (vite dev, screenshot tests) it answers from an in-memory stand-in driven by the URL
// (?lang=tr&appearance=dark&section=settings&platform=macos).
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import en from '../locales/en.json';
import es from '../locales/es.json';
import zhHans from '../locales/zh-Hans.json';
import ja from '../locales/ja.json';
import de from '../locales/de.json';
import fr from '../locales/fr.json';
import ptBR from '../locales/pt-BR.json';
import ar from '../locales/ar.json';
import ko from '../locales/ko.json';
import it from '../locales/it.json';
import ru from '../locales/ru.json';
import tr from '../locales/tr.json';

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
  /** Web downloads: the clipboard shortcut, and whether the first-use notice was shown. */
  web: { shortcut: boolean; noticeShown: boolean };
  /** Window layouts: the feature (off by default) and, while it is on, its global shortcuts. */
  layouts: { enabled: boolean; shortcuts: boolean };
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

export type Section = 'home' | 'library' | 'automation' | 'settings';

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
  origin: 'convert' | 'tool' | 'paste' | 'download';
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
/** How much of a code may be damaged and still read: about 7, 15, 25 and 30 %. */
export type QrCorrection = 'low' | 'medium' | 'quartile' | 'high';
export type QrPicture = 'png' | 'svg';
export interface QrStyle {
  correction: QrCorrection;
  /** The side in pixels, quiet zone included. */
  size: number;
  dark: [number, number, number];
  light: [number, number, number];
}
export type QrProblem = 'empty' | 'too-long' | 'low-contrast';
export interface QrPreview {
  svg: string | null;
  problem: QrProblem | null;
  /** WCAG's ratio of the two colours, 1 to 21. */
  contrast: number;
  /** Light modules on a dark background. */
  inverted: boolean;
}

/** The languages the system's text recognition reads, as BCP 47 tags. */
export interface OcrLanguages {
  available: string[];
  suggested: string | null;
  /** The interface language. */
  interface: string;
  /** The system's language. */
  system: string | null;
}

/** The first subtitle of a file, in seconds, without tags. */
export interface SubtitleSample {
  start: number;
  end: number;
  text: string;
}

export interface ActionEntry {
  id: string;
  icon: string;
  /** Copy and Move: the folders last chosen for either, newest first, that still exist. */
  folders?: string[];
}

/** A Copy or Move without the folder dialog, or ZIP in another archive format. */
export interface ActionOptions {
  folder?: string;
  format?: '7z' | 'tar-gz';
}

/** A choice from a Convert slice's ring: the picture quality of JPG, WEBP and AVIF; the resolution
 *  of pages turned into pictures (96, 150, 300 dpi); the size of a GIF made from a video; the bit
 *  rate of MP3 and M4A. Without one the usual settings apply. */
export type ConvertPreset =
  | 'high'
  | 'balanced'
  | 'small'
  | 'screen'
  | 'normal'
  | 'print'
  | 'gif-small'
  | 'gif-medium'
  | 'gif-large'
  | 'kbps128'
  | 'kbps192'
  | 'kbps320';

export type WheelKind = 'convert' | 'tools' | 'actions' | 'window';

/** What the floating wheel shows; paths are known up front only without a drag. The Window ring
 *  has no paths but the title of the window it places. */
export interface WheelSession {
  id: number;
  kind: WheelKind;
  mode: 'drag' | 'click';
  paths: string[];
  window?: string;
}

/** Window layouts (SPEC 5.12). */
export type LayoutId =
  'left-half' | 'right-half' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'full-screen';

export interface LayoutStatus {
  /** macOS needs the Accessibility permission; Windows needs none. */
  permission: 'not-needed' | 'granted' | 'missing';
  /** Each layout's shortcut as the system writes it, and whether another app holds it. */
  shortcuts: { layout: LayoutId; keys: string; taken: boolean }[];
}

/** A system drag over a window: positions in CSS pixels of that window. A drag carries files, or
 *  a web address (a link or a media card out of a browser), or neither. */
export type DragOver =
  | { type: 'enter'; paths: string[]; link: string | null; x: number; y: number }
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; paths: string[]; link: string | null; x: number; y: number }
  | { type: 'leave' };

/** What a drop on Home brought: files, or one web address. */
export interface Dropped {
  paths: string[];
  link: string | null;
}

/** Web media download (SPEC 5.10): what a link holds, as yt-dlp found it. */
export type WebSite = 'youtube' | 'instagram' | 'other';
export type WebKind = 'video' | 'audio' | 'images';

/** A picture of a photo post; `index` is its place in the post. */
export interface WebImage {
  index: number;
  width: number | null;
  height: number | null;
  /** A small preview the core can fetch (WebInfo.url plus the index ask for it). */
  preview: string | null;
}

export interface WebInfo {
  url: string;
  site: WebSite;
  kind: WebKind;
  title: string;
  /** Seconds, for video and audio. */
  duration: number | null;
  /** Frame heights on offer, highest first; empty for audio and pictures. */
  heights: number[];
  /** The thumbnail can be downloaded on its own (YouTube). */
  thumbnail: boolean;
  images: WebImage[];
}

/** What to download from a link. */
export type WebChoice =
  | { kind: 'video'; maxHeight: number | null }
  /** The sound as MP3. */
  | { kind: 'audio' }
  /** The sound as M4A (AAC), or as the site serves it. */
  | { kind: 'audioAs'; format: AudioFormat }
  | { kind: 'thumbnail' }
  | { kind: 'images'; indexes: number[] }
  | { kind: 'original' };

export type AudioFormat = 'mp3' | 'm4a' | 'original';

/** Why a link cannot be used: a message key of the locale files and the technical details. */
export interface WebProblem {
  key: string;
  details: string;
}

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
    }
  /** `size`: percent of the usual subtitle size, 50 to 250. Paths: the video and its subtitles. */
  | { tool: 'burn-subtitles'; size: number; position: 'bottom' | 'top' };

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
  /** Whether the format can hold chapters, so they can be edited. */
  chaptersEditable: boolean;
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
  /** Bytes to download for this computer, only for the tools missing or outdated; 0 when nothing
   *  is offered or needed. */
  download: number;
  available: boolean;
  /** A tool in use comes from an earlier Kento download than the one this version pins. */
  outdated: boolean;
  /** Kento's own downloads of this group are on disk. */
  downloaded: boolean;
}

/** What "Update yt-dlp" did: a newer release is in place, or the copy in use is the newest. */
export interface YtDlpUpdate {
  outcome: 'updated' | 'current';
  version: string;
  status: ToolGroupStatus[];
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

/** One step of a recipe (SPEC 5.11): each takes the file the step before it gave. */
export type RecipeStep =
  | { kind: 'convert'; to: string }
  /** An aspect ratio, cropped from the middle. */
  | { kind: 'crop'; width: number; height: number }
  /** The longer side in pixels; never enlarges. */
  | { kind: 'resize'; longSide: number }
  | { kind: 'compress'; compression: Compression };

export interface Recipe {
  /** Empty for a recipe not saved yet. */
  id: string;
  name: string;
  steps: RecipeStep[];
}

/** A recipe on the wheel's Favorites ring, with the tool group it still needs. */
export interface RecipeEntry extends Recipe {
  needs: ToolGroup | null;
}

/** Which new files a folder rule takes. Sizes in bytes. */
export interface RuleFilter {
  extensions: string[];
  pattern: string;
  minSize: number | null;
  maxSize: number | null;
}

export type RuleAction =
  | { kind: 'convert'; to: string }
  | { kind: 'tool'; tool: string }
  | { kind: 'recipe'; recipe: string }
  | { kind: 'move' };

/** A folder automation rule (SPEC 5.11). */
export interface Rule {
  /** Empty for a rule not saved yet. */
  id: string;
  name: string;
  enabled: boolean;
  folder: string;
  subfolders: boolean;
  filter: RuleFilter;
  action: RuleAction;
  output: string;
}

export interface RuleView extends Rule {
  /** The output folder is inside the watched one. */
  outputInside: boolean;
  /** A message key: a folder or the recipe is gone, or the folder cannot be watched. */
  problem: string | null;
}

export type Outcome = 'queued' | 'done' | 'failed' | 'skipped' | 'cancelled';

/** One file a rule handled; never its contents. */
export interface Activity {
  id: number;
  /** Unix time in milliseconds. */
  at: number;
  rule: string;
  ruleName: string;
  file: string;
  outcome: Outcome;
  message: string | null;
  outputs: string[];
}

/** A format some file converts to. */
export interface ConvertFormat {
  id: string;
  label: string;
  category: Category;
}

export interface AutomationView {
  paused: boolean;
  rules: RuleView[];
  /** Newest first. */
  activity: Activity[];
  targets: ConvertFormat[];
  /** The tools a rule can run (those that need no choices). */
  tools: string[];
}

/** A rule's failure, shown in the main window when it has the focus. */
export interface AutomationFailure {
  title: string;
  message: string;
  details: string | null;
}

/** How this copy updates (SPEC 5.16): the installer, the portable ZIP, a Mac app (one Kento may
 *  change, one it may not, one macOS runs translocated) or a development build that never does. */
export type UpdateKind = 'installed' | 'portable' | 'bundle' | 'lockedBundle' | 'translocated' | 'development';

export type UpdateReason = 'offline' | 'signature' | 'install' | 'other';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; received: number; total: number | null }
  | { state: 'confirm'; version: string }
  | { state: 'waiting'; version: string; jobs: number; paused: boolean; editing: boolean; installs: boolean }
  | { state: 'restarting'; version: string }
  | { state: 'failed'; reason: UpdateReason };

export interface UpdateView {
  current: string;
  kind: UpdateKind;
  /** When the last check that reached GitHub ended, in Unix milliseconds. */
  lastCheck: number | null;
  status: UpdateStatus;
}

/** The release notes of the version this start installed: plain text, never markup. */
export interface UpdateNews {
  version: string;
  notes: string;
}

export interface Api {
  bootstrap(): Promise<Bootstrap>;
  saveSettings(settings: Settings): Promise<Saved>;
  uiReady(): Promise<void>;
  openLink(which: 'website' | 'repository' | 'releases'): Promise<void>;
  chooseFolder(): Promise<string | null>;
  setJobsPaused(paused: boolean): Promise<void>;
  cancelJob(id: number): Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
  onJob(handler: (job: JobInfo) => void): Promise<UnlistenFn>;
  onPaused(handler: (paused: boolean) => void): Promise<UnlistenFn>;
  /** The core opens a page: one of the sections, or Settings › Updates. */
  onNavigate(handler: (section: Section | 'updates') => void): Promise<UnlistenFn>;
  onLibrary(handler: () => void): Promise<UnlistenFn>;
  /** Files or a link dropped on the main window; `hover` says whether a drop would be taken. */
  onDrop(handler: (dropped: Dropped) => void, hover: (over: boolean) => void): Promise<UnlistenFn>;
  inspect(paths: string[]): Promise<FileEntry[]>;
  targets(paths: string[]): Promise<TargetGroup[]>;
  tools(paths: string[]): Promise<ToolEntry[]>;
  convert(paths: string[], to: string, preset?: ConvertPreset): Promise<number[]>;
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
  /** The code for the text as it stands, or why there is none. */
  qrPreview(text: string, style: QrStyle): Promise<QrPreview>;
  /** Saves the code; `folder` is null for the default folder, else one from webChooseFolder. */
  makeQr(text: string, style: QrStyle, picture: QrPicture, folder: string | null): Promise<number>;
  /** Opens Make a QR code in the main window (the floating wheel's link ring). */
  qrOpen(text: string): Promise<void>;
  /** The text the main window should open Make a QR code with, once. */
  qrTakePending(): Promise<string | null>;
  onQrOpen(handler: () => void): Promise<UnlistenFn>;
  ocrLanguages(): Promise<OcrLanguages>;
  runOcr(paths: string[], language: string): Promise<number[]>;
  subtitleSample(path: string): Promise<SubtitleSample | null>;
  actions(): Promise<ActionEntry[]>;
  runAction(action: string, paths: string[], options?: ActionOptions): Promise<number[]>;
  openTool(tool: string, paths: string[]): Promise<void>;
  takePendingTool(): Promise<[string, string[]] | null>;
  onOpenTool(handler: (tool: string, paths: string[]) => void): Promise<UnlistenFn>;
  /** The webview's own drag events (files only; the shelf). */
  onDragOver(handler: (event: DragOver) => void): Promise<UnlistenFn>;
  /** Kento's drag events, with links as well as files (the floating wheel). */
  onDrag(handler: (event: DragOver) => void): Promise<UnlistenFn>;
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
  /** Remove background: one job per picture, each writing a transparent PNG. */
  removeBackground(paths: string[]): Promise<number[]>;
  /** A PNG of the picture with its background removed, at most `size` px on its longer side; the
   *  first one for a picture runs the model, which takes a few seconds. */
  backgroundPreview(path: string, size: number): Promise<Blob>;
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
  /** Asks GitHub for the newest yt-dlp and puts it beside Kento's own copy, checked against its
   *  published SHA-256. */
  toolsUpdateYtdlp(): Promise<YtDlpUpdate>;
  onToolsProgress(handler: (progress: InstallProgress) => void): Promise<UnlistenFn>;
  /** The tool group web downloads still need, or null when they work. */
  webNeeds(): Promise<ToolGroup | null>;
  /** What a link holds; rejects with a WebProblem. */
  webProbe(url: string): Promise<WebInfo>;
  /** The preview of one picture of a probed photo post; null when there is none. */
  webPreview(url: string, index: number): Promise<Blob | null>;
  webDefaultFolder(): Promise<string>;
  /** The system's folder dialog; null when it was closed. */
  webChooseFolder(): Promise<string | null>;
  /** Starts the download job; `folder` is null for the default folder. */
  webDownload(url: string, choice: WebChoice, folder: string | null): Promise<number>;
  /** Opens the download dialog in the main window (the floating wheel's More…). */
  webOpen(url: string): Promise<void>;
  /** The link the main window should open the dialog for, once. */
  webTakePending(): Promise<string | null>;
  onWebOpen(handler: () => void): Promise<UnlistenFn>;
  layoutsStatus(): Promise<LayoutStatus>;
  /** A slice of the Window ring: places the window that was in front when the ring opened. */
  layoutsApply(layout: LayoutId): Promise<void>;
  /** macOS: the system's prompt for the Accessibility permission, once Kento has said why. */
  layoutsAskPermission(): Promise<LayoutStatus>;
  layoutsOpenPermissionSettings(): Promise<void>;
  recipesList(): Promise<Recipe[]>;
  /** Adds a recipe (empty id) or replaces the one with its id; returns the list. */
  recipesSave(recipe: Recipe): Promise<Recipe[]>;
  recipesDelete(id: string): Promise<Recipe[]>;
  recipesReorder(ids: string[]): Promise<Recipe[]>;
  /** The recipes that fit every one of the files, for the wheel's Favorites ring. */
  recipesFor(paths: string[]): Promise<RecipeEntry[]>;
  runRecipe(id: string, paths: string[]): Promise<number[]>;
  onRecipes(handler: () => void): Promise<UnlistenFn>;
  automationView(): Promise<AutomationView>;
  /** The system's folder dialog; a rule can only be saved with folders chosen here. */
  automationChooseFolder(): Promise<string | null>;
  automationSaveRule(rule: Rule): Promise<AutomationView>;
  automationDeleteRule(id: string): Promise<AutomationView>;
  automationSetEnabled(id: string, enabled: boolean): Promise<AutomationView>;
  automationSetPaused(paused: boolean): Promise<AutomationView>;
  automationClearActivity(): Promise<AutomationView>;
  onAutomation(handler: () => void): Promise<UnlistenFn>;
  onAutomationFailed(handler: (failure: AutomationFailure) => void): Promise<UnlistenFn>;
  updatesView(): Promise<UpdateView>;
  /** Looks for a new version now; `show` opens Settings › Updates in the main window. */
  updatesCheck(show: boolean): Promise<void>;
  /** "Update and restart": a Mac app Kento may not change installs once the user asks. */
  updatesInstall(): Promise<void>;
  /** Whether a dialog in the main window holds the user's work; a ready update waits for it. */
  updatesEditing(editing: boolean): Promise<void>;
  /** The notes of the version this start installed, once. */
  updatesNews(): Promise<UpdateNews | null>;
  onUpdates(handler: (view: UpdateView) => void): Promise<UnlistenFn>;
}

/** Kento's drag event as the core sends it: physical pixels. */
function scaled(event: DragOver): DragOver {
  if (event.type === 'leave') return event;
  const scale = window.devicePixelRatio || 1;
  return { ...event, x: event.x / scale, y: event.y / scale };
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
  onNavigate: (handler) => listen<Section | 'updates'>('navigate', (event) => handler(event.payload)),
  onLibrary: (handler) => listen('library', () => handler()),
  onDrop: (handler, hover) => {
    // Only files and links are taken; a drag of anything else leaves Home as it is.
    let taken = false;
    return listen<DragOver>('drag', ({ payload }) => {
      if (payload.type === 'enter') taken = payload.paths.length > 0 || !!payload.link;
      hover(taken && (payload.type === 'enter' || payload.type === 'over'));
      if (payload.type === 'drop' && (payload.paths.length || payload.link)) {
        handler({ paths: payload.paths, link: payload.link });
      }
      if (payload.type === 'drop' || payload.type === 'leave') taken = false;
    });
  },
  inspect: (paths) => invoke('inspect', { paths }),
  targets: (paths) => invoke('targets', { paths }),
  tools: (paths) => invoke('tools', { paths }),
  convert: (paths, to, preset) => invoke('convert', { paths, to, preset: preset ?? null }),
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
  qrPreview: (text, style) => invoke('qr_preview', { text, style }),
  makeQr: (text, style, picture, folder) => invoke('make_qr', { text, style, picture, folder }),
  qrOpen: (text) => invoke('qr_open', { text }),
  qrTakePending: () => invoke('qr_take_pending'),
  onQrOpen: (handler) => listen('qr-open', () => handler()),
  ocrLanguages: () => invoke('ocr_languages'),
  runOcr: (paths, language) => invoke('run_ocr', { paths, language }),
  subtitleSample: (path) => invoke('subtitle_sample', { path }),
  actions: () => invoke('actions'),
  runAction: (action, paths, options) =>
    invoke('run_action', { action, paths, folder: options?.folder ?? null, format: options?.format ?? null }),
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
      if (payload.type === 'enter') handler({ type: 'enter', paths: payload.paths, link: null, x, y });
      else if (payload.type === 'over') handler({ type: 'over', x, y });
      else handler({ type: 'drop', paths: payload.paths, link: null, x, y });
    }),
  onDrag: (handler) => listen<DragOver>('drag', ({ payload }) => handler(scaled(payload))),
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
  removeBackground: (paths) => invoke('remove_background', { paths }),
  // Errors stay errors here: the panel says why there is no preview.
  backgroundPreview: async (path, size) =>
    new Blob([await invoke<ArrayBuffer>('background_preview', { path, size })], { type: 'image/png' }),
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
  toolsUpdateYtdlp: () => invoke('tools_update_ytdlp'),
  onToolsProgress: (handler) => listen<InstallProgress>('tools-progress', (event) => handler(event.payload)),
  webNeeds: () => invoke('web_needs'),
  webProbe: (url) => invoke('web_probe', { url }),
  webPreview: async (url, index) => {
    try {
      // A JPEG or WEBP; the image element reads the type from the bytes.
      return new Blob([await invoke<ArrayBuffer>('web_preview', { url, index })]);
    } catch {
      return null;
    }
  },
  webDefaultFolder: () => invoke('web_default_folder'),
  webChooseFolder: () => invoke('web_choose_folder'),
  webDownload: (url, choice, folder) => invoke('web_download', { url, choice, folder }),
  webOpen: (url) => invoke('web_open', { url }),
  webTakePending: () => invoke('web_take_pending'),
  onWebOpen: (handler) => listen('web-open', () => handler()),
  layoutsStatus: () => invoke('layouts_status'),
  layoutsApply: (layout) => invoke('layouts_apply', { layout }),
  layoutsAskPermission: () => invoke('layouts_ask_permission'),
  layoutsOpenPermissionSettings: () => invoke('layouts_open_permission_settings'),
  recipesList: () => invoke('recipes_list'),
  recipesSave: (recipe) => invoke('recipes_save', { recipe }),
  recipesDelete: (id) => invoke('recipes_delete', { id }),
  recipesReorder: (ids) => invoke('recipes_reorder', { ids }),
  recipesFor: (paths) => invoke('recipes_for', { paths }),
  runRecipe: (id, paths) => invoke('run_recipe', { id, paths }),
  onRecipes: (handler) => listen('recipes', () => handler()),
  automationView: () => invoke('automation_view'),
  automationChooseFolder: () => invoke('automation_choose_folder'),
  automationSaveRule: (rule) => invoke('automation_save_rule', { rule }),
  automationDeleteRule: (id) => invoke('automation_delete_rule', { id }),
  automationSetEnabled: (id, enabled) => invoke('automation_set_enabled', { id, enabled }),
  automationSetPaused: (paused) => invoke('automation_set_paused', { paused }),
  automationClearActivity: () => invoke('automation_clear_activity'),
  onAutomation: (handler) => listen('automation', () => handler()),
  onAutomationFailed: (handler) => listen<AutomationFailure>('automation-failed', (event) => handler(event.payload)),
  updatesView: () => invoke('updates_view'),
  updatesCheck: (show) => invoke('updates_check', { show }),
  updatesInstall: () => invoke('updates_install'),
  updatesEditing: (editing) => invoke('updates_editing', { editing }),
  updatesNews: () => invoke('updates_news'),
  onUpdates: (handler) => listen<UpdateView>('updates', (event) => handler(event.payload)),
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
  web: { shortcut: true, noticeShown: false },
  layouts: { enabled: false, shortcuts: true },
};

/** The browser stand-in: the same answers the core would give, from memory. */
export function browserApi(params: URLSearchParams): Api {
  const languages: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'zh-Hans', name: '简体中文' },
    { code: 'ja', name: '日本語' },
    { code: 'de', name: 'Deutsch' },
    { code: 'fr', name: 'Français' },
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'ar', name: 'العربية' },
    { code: 'ko', name: '한국어' },
    { code: 'it', name: 'Italiano' },
    { code: 'ru', name: 'Русский' },
    { code: 'tr', name: 'Türkçe' },
  ];
  const known = (code: string | null) =>
    code && (languages.some((l) => l.code === code) || code === 'en-XA' || code === 'ar-XB') ? code : null;
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    language: known(params.get('lang')) ?? 'system',
    appearance: (params.get('appearance') as Appearance | null) ?? 'system',
    // ?theme=<id> shows a theme (scripts/shoot-themes.mjs).
    theme: params.get('theme') ?? DEFAULT_SETTINGS.theme,
  };
  const resolve = (s: Settings) => (s.language === 'system' ? 'en' : s.language);
  let paused = false;
  const pausedHandlers = new Set<(paused: boolean) => void>();
  const platform = (params.get('platform') as Platform | null) ?? 'windows';
  // Recipes start with the example, as on a first start; ?automation=demo fills the rules and
  // the activity log.
  let recipes: Recipe[] = [demoRecipe(params.get('lang'))];
  let automation: AutomationView =
    params.get('automation') === 'demo'
      ? demoAutomation(platform, params.get('lang'))
      : { paused: false, rules: [], activity: [], targets: DEMO_CONVERT, tools: ['extract', 'mute'] };
  let picks = 0;
  const setAutomation = async (next: Partial<AutomationView>) => (automation = { ...automation, ...next });
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
      const repository = 'https://github.com/MehmetBurakTaskaya/kento';
      window.open(
        which === 'website'
          ? 'https://mehmetburaktaskaya.com'
          : which === 'releases'
            ? `${repository}/releases/latest`
            : repository,
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
        ...(only('image') ? ['images-to-pdf', 'compress'] : []),
        ...([...categories].every((c) => c === 'image' || c === 'pdf') ? ['read-qr', 'ocr'] : []),
        ...(only('archive') ? ['extract'] : []),
        ...(paths.length === 2 && categories.has('video') && categories.has('subtitle') ? ['burn-subtitles'] : []),
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
    qrPreview: async (text, style) => demoQr(text, style),
    makeQr: async () => 1,
    qrOpen: async () => {},
    qrTakePending: async () => null,
    onQrOpen: async () => () => {},
    // ?ocr=missing: the interface language has no recogniser on this computer.
    ocrLanguages: async () => {
      const ui = resolve(settings);
      const available = params.get('ocr') === 'missing' ? ['en-US', 'de-DE'] : ['en-US', 'tr'];
      const suggested = available.find((tag) => tag.split('-')[0] === ui.split('-')[0]) ?? 'en-US';
      return { available, suggested, interface: ui, system: 'en-US' };
    },
    runOcr: async (paths) => paths.map((_, index) => index + 1),
    subtitleSample: async () => ({ start: 1.2, end: 3.4, text: 'Kapadokya’da gün doğarken\nbalonlar havalanıyor' }),
    // Copy and Move remember the folders last chosen for them.
    actions: async () =>
      ['share', 'shelf', 'copy', 'move', 'copy-path', 'terminal', 'reveal', 'zip'].map((id) => ({
        id,
        icon: id,
        folders: id === 'copy' || id === 'move' ? demoFolders(platform) : [],
      })),
    runAction: async () => [],
    openTool: async () => {},
    takePendingTool: async () => null,
    onOpenTool: async () => () => {},
    onDragOver: async () => () => {},
    // ?surface=wheel&drag=link: a link dragged out of a browser enters the floating wheel.
    onDrag: async (handler) => {
      if (params.get('drag') === 'link') {
        setTimeout(() => handler({ type: 'enter', paths: [], link: DEMO_LINKS.youtube, x: 260, y: 260 }), 50);
      }
      return () => {};
    },
    // ?surface=wheel&wheel=convert shows the floating wheel for the demo files; wheel=window the
    // Window ring for a demo window.
    wheelSession: async () => {
      if (params.get('drag') === 'link') return { id: 1, kind: 'convert', mode: 'drag', paths: [] };
      const kind = params.get('wheel') as WheelKind | null;
      if (kind === 'window') return { id: 1, kind, mode: 'click', paths: [], window: 'Rapor 2026.docx - Word' };
      // &only=image keeps the photo alone, so the Tools wheel offers its Favorites; &only=images
      // brings a second picture, so the Convert wheel offers one PDF of both.
      const only = params.get('only');
      const paths =
        only === 'image'
          ? DEMO_FILES.slice(0, 1)
          : only === 'images'
            ? [DEMO_FILES[0]!, 'C:\\Users\\me\\Pictures\\Göreme gün batımı.jpg']
            : DEMO_FILES;
      return kind ? { id: 1, kind, mode: 'click', paths } : null;
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
    removeBackground: async (paths) => paths.map((_, i) => i + 1),
    backgroundPreview: async () => {
      throw new Error('No preview in the browser stand-in.');
    },
    runCompress: async (_compression, paths) => paths.map((_, i) => i + 1),
    metadataRead: async (path) => demoMetadata(path),
    runMetadata: async () => [1],
    toolsStatus: async () => demoTools(params.get('tools') === 'ready'),
    toolsInstall: async () => {},
    toolsCancel: async () => {},
    toolsRefresh: async () => demoTools(params.get('tools') === 'ready'),
    toolsRemove: async () => demoTools(false),
    toolsChoose: async () => null,
    toolsClearPath: async () => demoTools(params.get('tools') === 'ready'),
    toolsUpdateYtdlp: async () => ({
      outcome: 'current',
      version: '2026.10.26',
      status: demoTools(params.get('tools') === 'ready'),
    }),
    onToolsProgress: async () => () => {},
    // ?web=setup: the web tools are missing; ?web=probing: the probe never ends; ?web=<problem>
    // (drm, live, login, collection, unavailable, no-media, network, codec): the probe fails.
    webNeeds: async () => (params.get('web') === 'setup' ? 'media' : null),
    webProbe: (url) => {
      const mode = params.get('web');
      if (mode === 'probing') return new Promise<WebInfo>(() => {});
      if (mode && mode !== 'setup') {
        const key = mode === 'codec' ? 'error.codec.ytdlp' : `error.web.${mode}`;
        return Promise.reject<WebInfo>({ key, details: `yt-dlp: ERROR: [demo] ${mode}` });
      }
      return Promise.resolve(demoWeb(url));
    },
    webPreview: async (_url, index) => new Blob([demoPicture(index)], { type: 'image/svg+xml' }),
    webDefaultFolder: async () =>
      platform === 'macos' ? '/Users/me/Downloads/Kento' : 'C:\\Users\\me\\Downloads\\Kento',
    webChooseFolder: async () => (platform === 'macos' ? '/Users/me/Movies' : 'C:\\Users\\me\\Videos'),
    webDownload: async () => 1,
    webOpen: async () => {},
    webTakePending: async () => null,
    onWebOpen: async () => () => {},
    // ?layouts=missing shows macOS without the Accessibility permission; ?layouts=taken one
    // shortcut another app holds.
    layoutsStatus: async () => demoLayouts(platform, params.get('layouts')),
    layoutsApply: async () => {},
    layoutsAskPermission: async () => demoLayouts(platform, params.get('layouts')),
    layoutsOpenPermissionSettings: async () => {},
    recipesList: async () => recipes,
    recipesSave: async (recipe) => {
      const saved = { ...recipe, id: recipe.id || `r${recipes.length + 1}` };
      const known = recipes.some((item) => item.id === saved.id);
      recipes = known ? recipes.map((item) => (item.id === saved.id ? saved : item)) : [...recipes, saved];
      return recipes;
    },
    recipesDelete: async (id) => (recipes = recipes.filter((recipe) => recipe.id !== id)),
    recipesReorder: async (ids) => {
      const rank = (id: string) => (ids.includes(id) ? ids.indexOf(id) : ids.length);
      return (recipes = [...recipes].sort((a, b) => rank(a.id) - rank(b.id)));
    },
    // Every recipe of the stand-in works on pictures.
    recipesFor: async (paths) =>
      paths.length && paths.every((path) => demoEntry(path).category === 'image')
        ? recipes.map((recipe) => ({ ...recipe, needs: null }))
        : [],
    runRecipe: async (_id, paths) => paths.map((_, index) => index + 1),
    onRecipes: async () => () => {},
    automationView: async () => automation,
    // The folder to watch, then the output folder.
    automationChooseFolder: async () => {
      const [watched, output] = demoFolders(platform);
      return picks++ % 2 === 0 ? watched : output;
    },
    automationSaveRule: async (rule) => {
      const view = {
        ...rule,
        id: rule.id || `rule-${automation.rules.length + 1}`,
        outputInside: false,
        problem: null,
      };
      const known = automation.rules.some((item) => item.id === view.id);
      return setAutomation({
        rules: known
          ? automation.rules.map((item) => (item.id === view.id ? view : item))
          : [...automation.rules, view],
      });
    },
    automationDeleteRule: async (id) => setAutomation({ rules: automation.rules.filter((rule) => rule.id !== id) }),
    automationSetEnabled: async (id, enabled) =>
      setAutomation({ rules: automation.rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)) }),
    automationSetPaused: async (next) => setAutomation({ paused: next }),
    automationClearActivity: async () => setAutomation({ activity: [] }),
    onAutomation: async () => () => {},
    onAutomationFailed: async () => () => {},
    updatesView: async () => demoUpdate(params),
    updatesCheck: async () => {},
    updatesInstall: async () => {},
    updatesEditing: async () => {},
    // ?news=demo: the first start after an update, with its notes on Home.
    updatesNews: async () => (params.get('news') === 'demo' ? DEMO_NEWS : null),
    onUpdates: async () => () => {},
  };
}

/** Settings › Updates in the browser: ?update=waiting (or another state) and ?update-kind=portable
 *  (or another kind of copy). */
function demoUpdate(params: URLSearchParams): UpdateView {
  const version = DEMO_NEWS.version;
  const statuses: Record<UpdateStatus['state'], UpdateStatus> = {
    idle: { state: 'idle' },
    checking: { state: 'checking' },
    upToDate: { state: 'upToDate' },
    available: { state: 'available', version },
    downloading: { state: 'downloading', version, received: 12_400_000, total: 31_000_000 },
    confirm: { state: 'confirm', version },
    waiting: { state: 'waiting', version, jobs: 2, paused: false, editing: true, installs: false },
    restarting: { state: 'restarting', version },
    failed: { state: 'failed', reason: 'offline' },
  };
  const state = params.get('update') as UpdateStatus['state'] | null;
  return {
    current: '0.1.0',
    kind: (params.get('update-kind') as UpdateKind | null) ?? 'installed',
    lastCheck: Date.now() - 25 * 60_000,
    status: (state && statuses[state]) || statuses.upToDate,
  };
}

const DEMO_NEWS: UpdateNews = {
  version: '1.1.0',
  notes:
    'Added\n- Folder automation keeps the files that arrive while an update installs.\n\nFixed\n- Turkish file names in the command line.',
};

/** A text the core would give in the interface language. */
function coreText(lang: string | null, key: string): string {
  const dictionaries: Record<string, Record<string, string>> = {
    en,
    es,
    'zh-Hans': zhHans,
    ja,
    de,
    fr,
    'pt-BR': ptBR,
    ar,
    ko,
    it,
    ru,
    tr,
  };
  const dictionary: Record<string, string> = dictionaries[lang ?? 'en'] ?? en;
  return dictionary[key] ?? key;
}

/** The example recipe as the core writes it on a first start, named in the interface language. */
function demoRecipe(lang: string | null): Recipe {
  return {
    id: 'ready-for-instagram',
    name: coreText(lang, 'recipes.example.instagram'),
    steps: [
      { kind: 'crop', width: 4, height: 5 },
      { kind: 'resize', longSide: 1080 },
      { kind: 'compress', compression: { mode: 'size', bytes: 2_000_000 } },
    ],
  };
}

const DEMO_CONVERT: ConvertFormat[] = [
  ...['jpg', 'png', 'webp', 'avif', 'heic', 'tiff', 'gif', 'bmp', 'ico'].map((id) => ({
    id,
    label: id.toUpperCase(),
    category: 'image' as const,
  })),
  { id: 'pdf', label: 'PDF', category: 'pdf' },
  ...['mp4', 'webm', 'mov'].map((id) => ({ id, label: id.toUpperCase(), category: 'video' as const })),
  ...['mp3', 'm4a', 'flac', 'wav'].map((id) => ({ id, label: id.toUpperCase(), category: 'audio' as const })),
  ...['txt', 'md', 'docx'].map((id) => ({ id, label: id.toUpperCase(), category: 'document' as const })),
];

/** A folder to watch and an output folder, in the platform's own form. */
function demoFolders(platform: Platform): [string, string] {
  return platform === 'macos'
    ? ['/Users/me/Pictures/Screenshots', '/Users/me/Pictures/Optimized']
    : ['C:\\Users\\me\\Pictures\\Screenshots', 'C:\\Users\\me\\Pictures\\Optimized'];
}

function demoAutomation(platform: Platform, lang: string | null): AutomationView {
  const mac = platform === 'macos';
  const at = (...parts: string[]) => (mac ? ['/Users/me', ...parts].join('/') : ['C:\\Users\\me', ...parts].join('\\'));
  const filter = (extensions: string[], minSize: number | null = null): RuleFilter => ({
    extensions,
    pattern: '',
    minSize,
    maxSize: null,
  });
  const now = Date.now();
  const entry = (id: number, ago: number, rule: string, ruleName: string, file: string, outcome: Outcome) => ({
    id,
    at: now - ago,
    rule,
    ruleName,
    file,
    outcome,
    message: null,
    outputs: [],
  });
  return {
    paused: false,
    targets: DEMO_CONVERT,
    tools: ['extract', 'mute'],
    rules: [
      {
        id: 'shots',
        name: 'Ekran görüntüleri → WEBP',
        enabled: true,
        folder: at('Pictures', 'Screenshots'),
        subfolders: false,
        filter: filter(['png']),
        action: { kind: 'convert', to: 'webp' },
        output: at('Pictures', 'Optimized'),
        outputInside: false,
        problem: null,
      },
      {
        id: 'instagram',
        name: '',
        enabled: true,
        folder: at('Desktop', 'Instagram 📷'),
        subfolders: true,
        filter: filter(['jpg', 'heic'], 100_000),
        action: { kind: 'recipe', recipe: 'ready-for-instagram' },
        output: at('Desktop', 'Instagram 📷', 'Hazır'),
        outputInside: true,
        problem: null,
      },
      {
        id: 'archives',
        name: 'Arşivler',
        enabled: false,
        folder: at('Downloads'),
        subfolders: false,
        filter: { ...filter(['zip', '7z']), pattern: 'rapor*' },
        action: { kind: 'tool', tool: 'extract' },
        output: at('Documents', 'Açılanlar'),
        outputInside: false,
        problem: 'automation.problem.output',
      },
    ],
    activity: [
      entry(6, 4_000, 'shots', 'Ekran görüntüleri → WEBP', 'Ekran görüntüsü 2026-11-02 104512.png', 'queued'),
      {
        ...entry(5, 95_000, 'shots', 'Ekran görüntüleri → WEBP', 'Ekran görüntüsü 2026-11-02 103001.png', 'done'),
        outputs: [at('Pictures', 'Optimized', 'Ekran görüntüsü 2026-11-02 103001.webp')],
      },
      {
        ...entry(4, 600_000, 'instagram', 'Instagram 📷', 'Kapadokya 🎈.heic', 'failed'),
        message: coreText(lang, 'error.unreadable'),
      },
      {
        ...entry(3, 3_600_000, 'instagram', 'Instagram 📷', 'gezi.mp4', 'skipped'),
        message: coreText(lang, 'automation.skipped.recipe'),
      },
      entry(2, 86_400_000, 'shots', 'Ekran görüntüleri → WEBP', 'eski.png', 'cancelled'),
    ],
  };
}

const LAYOUT_KEYS: Record<LayoutId, [string, string]> = {
  'left-half': ['←', '←'],
  'right-half': ['→', '→'],
  'top-left': ['Home', 'U'],
  'top-right': ['Page Up', 'I'],
  'bottom-left': ['End', 'J'],
  'bottom-right': ['Page Down', 'K'],
  center: ['↓', '↓'],
  'full-screen': ['↑', '↑'],
};

function demoLayouts(platform: Platform, state: string | null): LayoutStatus {
  const mac = platform === 'macos';
  return {
    permission: mac ? (state === 'missing' ? 'missing' : 'granted') : 'not-needed',
    shortcuts: (Object.keys(LAYOUT_KEYS) as LayoutId[]).map((layout) => ({
      layout,
      keys: mac ? `⌃⌥⌘${LAYOUT_KEYS[layout][1]}` : `Ctrl+Alt+${LAYOUT_KEYS[layout][0]}`,
      taken: state === 'taken' && layout === 'center',
    })),
  };
}

/** Links the stand-in knows; any other link reads as a plain video page. */
export const DEMO_LINKS = {
  youtube: 'https://www.youtube.com/watch?v=K3nt0dEmo42',
  post: 'https://www.instagram.com/p/K3nt0P0st/',
  reel: 'https://www.instagram.com/reel/K3nt0Re3l/',
  podcast: 'https://podcast.example.org/bolum-12',
};

function demoWeb(url: string): WebInfo {
  const base = { url, duration: null, heights: [], thumbnail: false, images: [] };
  if (url === DEMO_LINKS.youtube) {
    return {
      ...base,
      site: 'youtube',
      kind: 'video',
      title: 'Kapadokya’da gün doğumu: balon turu 🎈 (4K)',
      duration: 754.3,
      heights: [2160, 1440, 1080, 720, 480, 360],
      thumbnail: true,
    };
  }
  if (url === DEMO_LINKS.post) {
    return {
      ...base,
      site: 'instagram',
      kind: 'images',
      title: 'Göreme, Mayıs 2026',
      images: Array.from({ length: 6 }, (_, index) => ({
        index,
        width: 1080,
        height: 1350,
        preview: `https://cdn.example.org/p/${index}.jpg`,
      })),
    };
  }
  if (url === DEMO_LINKS.reel) {
    return {
      ...base,
      site: 'instagram',
      kind: 'video',
      title: 'Peri bacaları 30 saniyede',
      duration: 31,
      heights: [1280, 640],
    };
  }
  if (url === DEMO_LINKS.podcast) {
    return { ...base, site: 'other', kind: 'audio', title: 'Bölüm 12: Yerel ilk yazılım', duration: 2843 };
  }
  const host = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)?.[1] ?? url;
  return { ...base, site: 'other', kind: 'video', title: host, duration: 95.4, heights: [1080, 720, 480] };
}

/** A small landscape in the colours of one picture of the demo post. */
function demoPicture(index: number): string {
  const hue = (200 + index * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 78%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 45% 46%)"/></linearGradient></defs><rect width="120" height="150" fill="url(#g)"/><circle cx="${30 + index * 12}" cy="42" r="13" fill="#fff" opacity=".75"/><path d="M0 118 34 82 58 104 84 78 120 112V150H0Z" fill="#1a1e23" opacity=".35"/></svg>`;
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
  vtt: ['vtt', 'subtitle'],
  mp4: ['mp4', 'video'],
};

/** WCAG 2's contrast ratio, as the core computes it for QR colours. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, b2] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A code-like drawing for the stand-in: finder squares and modules from the text. Real codes
 *  come from the core. */
function demoQr(text: string, style: QrStyle): QrPreview {
  const contrast = contrastRatio(style.dark, style.light);
  const inverted = contrastRatio(style.dark, [0, 0, 0]) > contrastRatio(style.light, [0, 0, 0]);
  const problem: QrProblem | null = !text
    ? 'empty'
    : new TextEncoder().encode(text).length > 2953
      ? 'too-long'
      : contrast < 3
        ? 'low-contrast'
        : null;
  if (problem) return { svg: null, problem, contrast, inverted };
  const width = 29;
  const side = width + 8;
  let seed = [...text].reduce((hash, c) => (hash * 31 + c.codePointAt(0)!) >>> 0, 7);
  const finder = (x: number, y: number) =>
    [
      [0, 0],
      [width - 7, 0],
      [0, width - 7],
    ].some(([fx, fy]) => {
      const [dx, dy] = [x - fx!, y - fy!];
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    });
  const nearFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > width - 9 && y < 8) || (x < 8 && y > width - 9);
  let path = '';
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const dark = nearFinder(x, y) ? finder(x, y) : (seed >>> 16) % 2 === 0;
      if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
  }
  const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${style.size}" height="${style.size}" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="${hex(style.light)}"/><path fill="${hex(style.dark)}" d="${path}"/></svg>`;
  return { svg, problem: null, contrast, inverted };
}

const DEMO_TARGETS: Partial<Record<Category, string[]>> = {
  image: ['jpg', 'png', 'webp', 'avif', 'pdf', 'tiff', 'gif', 'bmp', 'ico'],
  pdf: ['jpg', 'png', 'txt', 'md'],
  archive: ['zip', 'tar', 'tar-gz', '7z'],
  document: ['txt', 'md', 'html'],
  spreadsheet: ['csv', 'tsv', 'xlsx', 'html'],
  subtitle: ['srt', 'vtt', 'txt'],
};

function demoTools(ready: boolean): ToolGroupStatus[] {
  // FFmpeg under the group's version; yt-dlp and Deno each in a folder of their own version.
  const found = (id: string, folder: string, version: string) => ({
    id,
    path: ready ? `C:\\Users\\me\\AppData\\Local\\Kento\\tools\\media\\${folder}\\${id}.exe` : null,
    version: ready ? version : null,
    source: ready ? ('kento' as const) : null,
  });
  return [
    {
      id: 'media',
      ready,
      tools: [
        found('ffmpeg', '9.0.2', '9.0.2'),
        found('ffprobe', '9.0.2', '9.0.2'),
        found('yt-dlp', 'yt-dlp\\2026.10.26', '2026.10.26'),
        found('deno', 'deno\\2.9.8', '2.9.8'),
      ],
      // The pinned Windows downloads: FFmpeg's 7z, yt-dlp.exe and Deno's zip; nothing once ready.
      download: ready ? 0 : 35_430_500 + 23_575_744 + 42_917_472,
      available: true,
      outdated: false,
      downloaded: ready,
    },
    {
      id: 'office',
      ready,
      tools: [
        {
          id: 'soffice',
          path: ready
            ? 'C:\\Users\\me\\AppData\\Local\\Kento\\tools\\office\\26.8.2\\LibreOffice\\program\\soffice.exe'
            : null,
          version: ready ? '26.8.2' : null,
          source: ready ? ('kento' as const) : null,
        },
      ],
      // The pinned Windows installer.
      download: ready ? 0 : 375_934_976,
      available: true,
      outdated: false,
      downloaded: ready,
    },
    {
      id: 'extras',
      ready,
      tools: [
        {
          id: 'exiftool',
          path: ready ? 'C:\\Users\\me\\AppData\\Local\\Kento\\tools\\extras\\13.60\\exiftool.exe' : null,
          version: ready ? '13.60' : null,
          source: ready ? ('kento' as const) : null,
        },
        {
          id: 'onnxruntime',
          path: ready
            ? 'C:\\Users\\me\\AppData\\Local\\Kento\\tools\\extras\\onnxruntime\\1.23.2\\onnxruntime.dll'
            : null,
          version: ready ? '1.23.2' : null,
          source: ready ? ('kento' as const) : null,
        },
        {
          id: 'bg-model',
          path: ready ? 'C:\\Users\\me\\AppData\\Local\\Kento\\tools\\extras\\bg-model\\1.0\\BEN2_Base.onnx' : null,
          version: ready ? '1.0' : null,
          source: ready ? ('kento' as const) : null,
        },
      ],
      // ExifTool's zip, ONNX Runtime's zip and the model, as pinned for Windows.
      download: ready ? 0 : 11_198_064 + 78_127_794 + 222_932_053,
      available: true,
      outdated: false,
      downloaded: ready,
    },
  ];
}

/** What the Metadata panel shows for the demo files: a phone photo, a video with chapters, a
 *  report. */
function demoMetadata(path: string): MetadataInfo {
  const field = (group: string, name: string, value: string): MetadataField => ({
    key: `${group}:${name}`,
    group,
    name,
    value,
    editable: false,
  });
  const edit = (key: string, group: string, name: string, value: string): MetadataField => ({
    key,
    group,
    name,
    value,
    editable: true,
  });
  const kind = demoEntry(path).category ?? (/\.(mp4|mov|mkv|webm|mp3|m4a)$/i.test(path) ? 'video' : null);
  if (kind === 'pdf') {
    return {
      fields: [
        edit('title', 'PDF', 'Title', 'Rapor 2026'),
        edit('author', 'PDF', 'Author', 'Ayşe Yılmaz'),
        edit('subject', 'PDF', 'Subject', 'Yıllık değerlendirme'),
        edit('keywords', 'PDF', 'Keywords', 'rapor, 2026'),
        edit('creator', 'PDF', 'Creator', 'Writer'),
        edit('producer', 'PDF', 'Producer', 'Kento'),
        field('PDF', 'CreationDate', '2026-01-12 09:30:00 +03:00'),
        field('PDF', 'ModDate', '2026-02-02 17:05:00 +03:00'),
        field('Document', 'Version', '1.7'),
        field('Document', 'Pages', '6'),
        field('XMP', 'Metadata', '3412 B'),
      ],
      chapters: [],
      hasLocation: false,
      chaptersEditable: false,
    };
  }
  if (kind === 'video') {
    const tags = ['title', 'artist', 'album', 'album_artist', 'date', 'track', 'genre', 'comment', 'composer'];
    const values: Record<string, string> = { title: 'Gezi 🎒', artist: 'Ayşe Yılmaz', date: '2026', genre: 'Belgesel' };
    return {
      fields: [
        ...tags.map((key) => edit(key, 'Format', key, values[key] ?? '')),
        field('Format', 'major_brand', 'isom'),
        field('Format', 'encoder', 'Lavf61.7.100'),
        field('Format', 'location', '+38.6430+034.8281/'),
        field('Stream 0 · video', 'handler_name', 'VideoHandler'),
        field('Stream 1 · audio', 'language', 'tur'),
      ],
      chapters: [
        { start: 0, end: 42.5, title: 'Giriş' },
        { start: 42.5, end: 95.4, title: 'Kapadokya' },
      ],
      hasLocation: true,
      chaptersEditable: true,
    };
  }
  return {
    fields: [
      edit('title', 'XMP', 'Title', 'Göreme’de gün doğumu'),
      edit('author', 'EXIF', 'Artist', 'Ayşe Yılmaz'),
      edit('description', 'EXIF', 'ImageDescription', ''),
      edit('copyright', 'EXIF', 'Copyright', '© 2026 Ayşe Yılmaz'),
      edit('keywords', 'XMP', 'Keywords', 'balon, Kapadokya'),
      edit('date', 'EXIF', 'DateTimeOriginal', '2026-05-01 06:12:44'),
      field('File', 'FileType', 'HEIC'),
      field('File', 'ImageWidth', '4032'),
      field('File', 'ImageHeight', '3024'),
      field('EXIF', 'Make', 'Apple'),
      field('EXIF', 'Model', 'iPhone 15 Pro'),
      field('EXIF', 'Orientation', 'Rotate 90 CW'),
      field('EXIF', 'ExposureTime', '1/120'),
      field('EXIF', 'FNumber', '1.8'),
      field('EXIF', 'ISO', '64'),
      field('EXIF', 'LensModel', 'iPhone 15 Pro back triple camera 6.765mm f/1.78'),
      field('GPS', 'GPSLatitude', '38 deg 38\' 34.92" N'),
      field('GPS', 'GPSLongitude', '34 deg 49\' 41.16" E'),
      field('GPS', 'GPSAltitude', '1071.2 m Above Sea Level'),
      field('XMP', 'CreatorTool', '17.4'),
      field('ICC_Profile', 'ProfileDescription', 'Display P3'),
    ],
    chapters: [],
    hasLocation: true,
    chaptersEditable: false,
  };
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
