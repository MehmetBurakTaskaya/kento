// SPDX-License-Identifier: MIT
// What kind of media a path is, by its extension, for the editors that take video and audio alike.

const AUDIO = /\.(aiff?|flac|m4a|mp3|ogg|opus|wav|wma)$/i;

/** An audio file: its editor shows the waveform instead of the picture. */
export const isAudio = (path: string) => AUDIO.test(path);
