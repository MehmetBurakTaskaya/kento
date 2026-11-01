// SPDX-License-Identifier: MIT
// The page's only door to the app core. Inside Kento it calls the Rust commands; in a plain browser
// (vite dev, screenshot tests) it answers from an in-memory stand-in driven by the URL
// (?lang=tr&appearance=dark&section=settings&platform=macos).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
  shelfModel: string;
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
    | { state: 'failed'; message: string }
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
};

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
  shelfModel: 'local-only',
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
  };
}

export const api: Api = isTauri() ? tauriApi : browserApi(new URLSearchParams(window.location.search));
