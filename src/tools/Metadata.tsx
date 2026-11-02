// SPDX-License-Identifier: MIT
// Metadata (SPEC 5.5): what a file carries, the common fields to edit, and removing everything or
// only the location; the result is a new copy.
import type { FileEntry } from '../ipc';

export function MetadataPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  void entries;
  void onClose;
  return null;
}
