// SPDX-License-Identifier: MIT
// Compress (SPEC 5.5): images, video, audio and PDF, each kept in its own format, by quality, by
// a share of the original size, or under a target size.
import type { FileEntry } from '../ipc';

export function CompressPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  void entries;
  void onClose;
  return null;
}
