// SPDX-License-Identifier: MIT
// The page's state: what the core said at start, the settings, the jobs, the open section, the
// files on Home, the Library, the open wheel or tool panel and the cards in the corner.
// Settings are saved through the core, which applies their side effects (tray, sign-in item…).
import { create } from 'zustand';
import type { MediaPanel } from '../editors';
import { changeLanguage } from '../i18n';
import {
  api,
  type Bootstrap,
  type FileEntry,
  type JobInfo,
  type LibraryEntry,
  type Section,
  type Settings,
} from '../ipc';

export type WheelKind = 'convert' | 'tools' | 'actions';

/** A tool that needs choices before it runs. */
export type PanelTool = 'merge-pdf' | 'split-pdf' | 'edit-pdf' | 'images-to-pdf' | 'read-qr' | MediaPanel;

export type Toast =
  | { id: number; kind: 'done'; jobId: number; title: string; outputs: string[] }
  | { id: number; kind: 'failed'; jobId: number; title: string; message: string; details: string | null }
  | { id: number; kind: 'info'; message: string };

type NewToast = Toast extends infer T ? (T extends Toast ? Omit<T, 'id'> : never) : never;

interface AppStore {
  boot: Bootstrap | null;
  settings: Settings | null;
  language: string;
  section: Section;
  jobs: Record<number, JobInfo>;
  /** Jobs started from this window: their end shows a card. */
  mine: Set<number>;
  paused: boolean;
  files: FileEntry[];
  selected: Set<string>;
  library: LibraryEntry[];
  wheel: { kind: WheelKind; paths: string[] } | null;
  panel: { tool: PanelTool; paths: string[] } | null;
  /** The tool setup dialog (SPEC 5.15). */
  setup: boolean;
  toasts: Toast[];
  setBoot(boot: Bootstrap): void;
  setSection(section: Section): void;
  update(patch: Partial<Settings>): Promise<void>;
  jobChanged(job: JobInfo): void;
  setPaused(paused: boolean): void;
  addFiles(paths: string[]): Promise<FileEntry[]>;
  addEntries(entries: FileEntry[]): void;
  removeFiles(paths: string[]): void;
  select(paths: string[]): void;
  /** The selected files, or every file when nothing is selected. */
  target(): string[];
  openWheel(kind: WheelKind, paths: string[]): void;
  closeWheel(): void;
  openPanel(tool: PanelTool, paths: string[]): void;
  closePanel(): void;
  openSetup(): void;
  closeSetup(): void;
  started(ids: number[]): void;
  refreshLibrary(): Promise<void>;
  toast(toast: NewToast): void;
  dismiss(id: number): void;
}

let toastId = 0;

export const useApp = create<AppStore>((set, get) => ({
  boot: null,
  settings: null,
  language: 'en',
  section: 'home',
  jobs: {},
  mine: new Set(),
  paused: false,
  files: [],
  selected: new Set(),
  library: [],
  wheel: null,
  panel: null,
  setup: false,
  toasts: [],
  setBoot: (boot) =>
    set({
      boot,
      settings: boot.settings,
      language: boot.language,
      paused: boot.paused,
      jobs: Object.fromEntries(boot.jobs.map((job) => [job.id, job])),
    }),
  setSection: (section) => set({ section }),
  update: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      const saved = await api.saveSettings(next);
      set({ settings: saved.settings, language: saved.language });
      await changeLanguage(saved.language);
    } catch (error) {
      set({ settings: current });
      void api.log('error', `settings not saved: ${String(error)}`);
    }
  },
  jobChanged: (job) => {
    const { mine, toast } = get();
    set((state) => ({ jobs: { ...state.jobs, [job.id]: job } }));
    if (!mine.has(job.id)) return;
    if (job.state === 'done') toast({ kind: 'done', jobId: job.id, title: job.title, outputs: job.outputs });
    if (job.state === 'failed') {
      toast({ kind: 'failed', jobId: job.id, title: job.title, message: job.message, details: job.details });
    }
  },
  setPaused: (paused) => set({ paused }),
  addFiles: async (paths) => {
    const entries = await api.inspect(paths);
    get().addEntries(entries);
    return entries;
  },
  addEntries: (entries) =>
    set((state) => {
      const known = new Set(state.files.map((file) => file.path));
      const fresh = entries.filter((entry) => !known.has(entry.path));
      // What just arrived becomes the selection, so Enter acts on it.
      return {
        files: [...state.files, ...fresh],
        selected: new Set(entries.map((entry) => entry.path)),
        section: 'home',
      };
    }),
  removeFiles: (paths) =>
    set((state) => {
      const gone = new Set(paths);
      return {
        files: state.files.filter((file) => !gone.has(file.path)),
        selected: new Set([...state.selected].filter((path) => !gone.has(path))),
      };
    }),
  select: (paths) => set({ selected: new Set(paths) }),
  target: () => {
    const { files, selected } = get();
    const chosen = files.filter((file) => selected.has(file.path));
    return (chosen.length ? chosen : files).map((file) => file.path);
  },
  openWheel: (kind, paths) => {
    if (paths.length) set({ wheel: { kind, paths } });
  },
  closeWheel: () => set({ wheel: null }),
  openPanel: (tool, paths) => set({ panel: { tool, paths }, wheel: null }),
  closePanel: () => set({ panel: null }),
  openSetup: () => set({ setup: true, wheel: null, section: 'home' }),
  closeSetup: () => set({ setup: false }),
  started: (ids) => set((state) => ({ mine: new Set([...state.mine, ...ids]) })),
  refreshLibrary: async () => {
    try {
      set({ library: await api.libraryList() });
    } catch (error) {
      void api.log('warn', `library not loaded: ${String(error)}`);
    }
  },
  toast: (toast) => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id } as Toast] }));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
