// SPDX-License-Identifier: MIT
// The page's state: what the core said at start, the settings, the jobs and the open section.
// Settings are saved through the core, which applies their side effects (tray, sign-in item…).
import { create } from 'zustand';
import { changeLanguage } from '../i18n';
import { api, type Bootstrap, type JobInfo, type Section, type Settings } from '../ipc';

interface AppStore {
  boot: Bootstrap | null;
  settings: Settings | null;
  language: string;
  section: Section;
  jobs: Record<number, JobInfo>;
  paused: boolean;
  setBoot(boot: Bootstrap): void;
  setSection(section: Section): void;
  update(patch: Partial<Settings>): Promise<void>;
  jobChanged(job: JobInfo): void;
  setPaused(paused: boolean): void;
}

export const useApp = create<AppStore>((set, get) => ({
  boot: null,
  settings: null,
  language: 'en',
  section: 'home',
  jobs: {},
  paused: false,
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
  jobChanged: (job) => set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
  setPaused: (paused) => set({ paused }),
}));
