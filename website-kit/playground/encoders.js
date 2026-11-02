// SPDX-License-Identifier: MIT
// The file writers the playground needs and browsers lack: BMP, TIFF, GIF, ICO and PDF, written from
// pixels by this file alone. A canvas writes PNG, JPEG and WebP (and AVIF where the browser can);
// these take what a canvas gives, RGBA pixels or PNG and JPEG bytes, and return the file's bytes.
// They follow Kento's own writers (src-tauri/engines/src/image/encode.rs and pdf/write.rs): a BMP is
// flattened onto white, a TIFF keeps transparency, a GIF has at most 256 colours, an icon holds
// several sizes, and a PDF is one page the size of the picture at 96 dpi.

/**
 * RGBA pixels as a canvas gives them: unpremultiplied, rows top to bottom.
 * @typedef {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} Pixels
 */

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

/**
 * The picture format of a file from its first bytes: 'png', 'jpg', 'gif', 'webp', 'bmp', 'tiff',
 * 'ico', 'avif', 'heic' or 'svg', or null for anything else. The name is not trusted.
 * @param {Uint8Array} head at least the first 512 bytes, when the file has them
 */
export function sniff(head) {
  const b = head;
  if (b.length < 4) return null;
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return 'tiff';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  if (ascii(b, 4, 8) === 'ftyp') {
    // The major and compatible brands of the ISO base media file: AVIF first, as an AVIF file may
    // also name the HEIF structure brand (mif1).
    const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const brands = ascii(b, 8, Math.min(Math.max(size, 16), 256));
    if (/avi[fs]/.test(brands)) return 'avif';
    if (/hei[cxms]|hev[cxms]|mif1|msf1/.test(brands)) return 'heic';
    return null;
  }
  const text = new TextDecoder().decode(b.subarray(0, 1024)).trimStart();
  if (text.startsWith('<') && /<svg[\s>]/i.test(text)) return 'svg';
  return null;
}

/** Whether a picture of this format was stored with lossy compression (a PDF keeps it as JPEG). */
export function lossy(format, head) {
  if (format === 'jpg' || format === 'avif' || format === 'heic') return true;
  if (format !== 'webp') return false;
  const text = ascii(head, 12, 512);
  return text.includes('VP8 ') && !text.includes('VP8L');
}

/** Whether any pixel is less than opaque. */
export function hasAlpha(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

/** A colour channel over white, as the app flattens pictures for formats without transparency. */
const onWhite = (c, a) => (a === 255 ? c : Math.round((c * a + 255 * (255 - a)) / 255));

/**
 * A 24-bit BMP (BITMAPINFOHEADER, rows bottom to top, each padded to four bytes), flattened onto white.
 * @param {Pixels} pixels
 */
export function bmp({ data, width, height }) {
  const stride = (width * 3 + 3) & ~3;
  const size = 54 + stride * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, stride * height, true);
  // 96 dpi in pixels per metre.
  v.setInt32(38, 3780, true);
  v.setInt32(42, 3780, true);
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * stride;
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4, o += 3) {
      const a = data[i + 3];
      out[o] = onWhite(data[i + 2], a);
      out[o + 1] = onWhite(data[i + 1], a);
      out[o + 2] = onWhite(data[i], a);
    }
  }
  return out;
}

/**
 * A baseline TIFF, uncompressed RGB, or RGBA with unassociated alpha when the picture has
 * transparency; little-endian, in strips of about 64 KB, 96 dpi.
 * @param {Pixels} pixels
 */
export function tiff({ data, width, height }) {
  const alpha = hasAlpha(data);
  const spp = alpha ? 4 : 3;
  const row = width * spp;
  const rows = Math.max(1, Math.min(height, Math.floor(65536 / row)));
  const strips = Math.ceil(height / rows);
  const counts = Array.from({ length: strips }, (_, s) => Math.min(rows, height - s * rows) * row);
  // [tag, type, values]: type 3 is SHORT, 4 LONG, 5 RATIONAL (two LONGs each); sorted by tag.
  const entries = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, Array(spp).fill(8)],
    [259, 3, [1]],
    [262, 3, [2]],
    [273, 4, Array(strips).fill(0)],
    [277, 3, [spp]],
    [278, 4, [rows]],
    [279, 4, counts],
    [282, 5, [96, 1]],
    [283, 5, [96, 1]],
    [284, 3, [1]],
    [296, 3, [2]],
  ];
  if (alpha) entries.push([338, 3, [2]]);
  const unit = { 3: 2, 4: 4, 5: 4 };
  const ifd = 8;
  let extra = ifd + 2 + entries.length * 12 + 4;
  const places = entries.map(([, type, values]) => {
    const bytes = values.length * unit[type];
    if (bytes <= 4) return -1;
    const at = extra;
    extra += bytes + (bytes & 1);
    return at;
  });
  const start = extra;
  entries[5][2] = counts.map((_, s) => start + s * rows * row);
  const out = new Uint8Array(start + row * height);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0], 0);
  v.setUint32(4, ifd, true);
  v.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, values], k) => {
    const e = ifd + 2 + k * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, type === 5 ? values.length / 2 : values.length, true);
    let at = places[k] < 0 ? e + 8 : places[k];
    if (places[k] >= 0) v.setUint32(e + 8, at, true);
    for (const value of values) {
      if (type === 3) v.setUint16(at, value, true);
      else v.setUint32(at, value, true);
      at += unit[type];
    }
  });
  if (alpha) out.set(data.subarray(0, width * height * 4), start);
  else out.set(rgbOf(data), start);
  return out;
}

/**
 * The picture's colours as at most 256 (255 and a transparent one when some pixels are less than
 * half opaque): every colour when there are that few, else a median cut of a 15-bit histogram.
 */
function quantize(data, count) {
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) {
      transparent = true;
      break;
    }
  }
  const limit = transparent ? 255 : 256;
  const indices = new Uint8Array(count);
  const exact = new Map();
  for (let i = 0; i < count && exact.size <= limit; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    if (!exact.has(key)) exact.set(key, exact.size);
  }
  let palette;
  if (exact.size <= limit) {
    palette = [...exact.keys()].map((key) => [key >> 16, (key >> 8) & 255, key & 255]);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      indices[i] = data[o + 3] < 128 ? limit : exact.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
    }
  } else {
    const hist = new Float64Array(32768 * 4);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      if (data[o + 3] < 128) continue;
      const h = (((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)) * 4;
      hist[h] += 1;
      hist[h + 1] += data[o];
      hist[h + 2] += data[o + 1];
      hist[h + 3] += data[o + 2];
    }
    const keys = [];
    for (let k = 0; k < 32768; k++) if (hist[k * 4] > 0) keys.push(k);
    const bins = Int32Array.from(keys);
    const channel = (key, c) => (c === 0 ? key >> 10 : c === 1 ? (key >> 5) & 31 : key & 31);
    const box = (start, end) => {
      const lo = [31, 31, 31];
      const hi = [0, 0, 0];
      let weight = 0;
      for (let i = start; i < end; i++) {
        for (let c = 0; c < 3; c++) {
          const value = channel(bins[i], c);
          if (value < lo[c]) lo[c] = value;
          if (value > hi[c]) hi[c] = value;
        }
        weight += hist[bins[i] * 4];
      }
      const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const wide = ranges.indexOf(Math.max(...ranges));
      return { start, end, weight, wide, score: end - start > 1 ? ranges[wide] * weight : -1 };
    };
    const boxes = [box(0, bins.length)];
    while (boxes.length < limit) {
      let pick = -1;
      for (let i = 0; i < boxes.length; i++)
        if (boxes[i].score > 0 && (pick < 0 || boxes[i].score > boxes[pick].score)) pick = i;
      if (pick < 0) break;
      const { start, end, weight, wide } = boxes[pick];
      bins.subarray(start, end).sort((a, b) => channel(a, wide) - channel(b, wide));
      // The split falls where half of the box's pixels lie on each side.
      let cut = start + 1;
      for (let i = start, seen = 0; i < end - 1; i++) {
        seen += hist[bins[i] * 4];
        cut = i + 1;
        if (seen >= weight / 2) break;
      }
      boxes.splice(pick, 1, box(start, cut), box(cut, end));
    }
    palette = boxes.map(({ start, end }) => {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = start; i < end; i++) {
        const h = bins[i] * 4;
        n += hist[h];
        r += hist[h + 1];
        g += hist[h + 2];
        b += hist[h + 3];
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
    // Each bin takes the palette colour nearest to the mean of its own pixels.
    const nearest = new Uint8Array(32768);
    for (const key of keys) {
      const h = key * 4;
      const n = hist[h];
      const r = hist[h + 1] / n;
      const g = hist[h + 2] / n;
      const b = hist[h + 3] / n;
      let best = 0;
      let distance = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const [pr, pg, pb] = palette[p];
        const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
        if (d < distance) {
          distance = d;
          best = p;
        }
      }
      nearest[key] = best;
    }
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      indices[i] =
        data[o + 3] < 128 ? limit : nearest[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)];
    }
  }
  if (transparent) {
    // Indices are 0 to 254, the transparent pixels 255; the palette is padded up to that slot.
    while (palette.length < limit) palette.push([0, 0, 0]);
    palette.push([0, 0, 0]);
  }
  return { palette, indices, transparent: transparent ? limit : -1 };
}

/** A growing byte buffer. */
function bytesOut(initial = 1 << 16) {
  let buffer = new Uint8Array(initial);
  let length = 0;
  const room = (n) => {
    if (length + n <= buffer.length) return;
    const next = new Uint8Array(Math.max(buffer.length * 2, length + n));
    next.set(buffer.subarray(0, length));
    buffer = next;
  };
  return {
    byte(value) {
      room(1);
      buffer[length++] = value;
    },
    bytes(values) {
      room(values.length);
      buffer.set(values, length);
      length += values.length;
    },
    u16(value) {
      this.byte(value & 255);
      this.byte((value >> 8) & 255);
    },
    size: () => length,
    done: () => buffer.slice(0, length),
  };
}

/**
 * GIF's variable-length LZW of 8-bit indices, in sub-blocks of up to 255 bytes. The string table
 * lives in an open-addressed hash of 5003 slots, as in the classic Unix compress; a full table (4096
 * codes) is cleared and started again.
 */
function lzw(indices, out) {
  const MIN = 8;
  const CLEAR = 1 << MIN;
  const END = CLEAR + 1;
  const MAX_CODES = 4096;
  const SLOTS = 5003;
  const keys = new Int32Array(SLOTS).fill(-1);
  const codes = new Int32Array(SLOTS);
  let bits = MIN + 1;
  let limit = (1 << bits) - 1;
  let next = END + 1;
  let cleared = false;
  let acc = 0;
  let held = 0;
  const block = new Uint8Array(255);
  let filled = 0;
  const flushBlock = () => {
    if (!filled) return;
    out.byte(filled);
    out.bytes(block.subarray(0, filled));
    filled = 0;
  };
  const put = (code) => {
    acc |= code << held;
    held += bits;
    while (held >= 8) {
      block[filled++] = acc & 255;
      if (filled === 255) flushBlock();
      acc >>>= 8;
      held -= 8;
    }
    // The decoder widens its codes once the table has outgrown them; so does the encoder, here.
    if (cleared) {
      bits = MIN + 1;
      limit = (1 << bits) - 1;
      cleared = false;
    } else if (next > limit && bits < 12) {
      bits += 1;
      limit = bits === 12 ? MAX_CODES : (1 << bits) - 1;
    }
  };
  out.byte(MIN);
  put(CLEAR);
  if (indices.length) {
    let prefix = indices[0];
    outer: for (let i = 1; i < indices.length; i++) {
      const c = indices[i];
      const key = (c << 12) + prefix;
      let slot = (c << 4) ^ prefix;
      if (keys[slot] === key) {
        prefix = codes[slot];
        continue;
      }
      if (keys[slot] >= 0) {
        const step = slot === 0 ? 1 : SLOTS - slot;
        do {
          slot -= step;
          if (slot < 0) slot += SLOTS;
          if (keys[slot] === key) {
            prefix = codes[slot];
            continue outer;
          }
        } while (keys[slot] >= 0);
      }
      put(prefix);
      prefix = c;
      if (next < MAX_CODES) {
        codes[slot] = next++;
        keys[slot] = key;
      } else {
        keys.fill(-1);
        next = END + 1;
        cleared = true;
        put(CLEAR);
      }
    }
    put(prefix);
  }
  put(END);
  if (held > 0) {
    block[filled++] = acc & 255;
    if (filled === 255) flushBlock();
  }
  flushBlock();
  out.byte(0);
}

/**
 * A GIF89a of one frame with a 256-colour table; pixels under half opacity become transparent.
 * @param {Pixels} pixels
 */
export function gif({ data, width, height }) {
  if (width > 65535 || height > 65535) throw new RangeError('A GIF is at most 65535 pixels on a side.');
  const { palette, indices, transparent } = quantize(data, width * height);
  const out = bytesOut(Math.min(width * height + 2048, 1 << 24));
  out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  out.u16(width);
  out.u16(height);
  // A global table of 256 entries, 8 bits a channel.
  out.byte(0xf7);
  out.byte(0);
  out.byte(0);
  for (let i = 0; i < 256; i++) out.bytes(palette[i] || [0, 0, 0]);
  if (transparent >= 0) out.bytes([0x21, 0xf9, 4, 1, 0, 0, transparent, 0]);
  out.byte(0x2c);
  out.u16(0);
  out.u16(0);
  out.u16(width);
  out.u16(height);
  out.byte(0);
  lzw(indices, out);
  out.byte(0x3b);
  return out.done();
}

/** The icon sizes for a picture: 16 to 256 pixels, never more than twice the picture (encode.rs). */
export function iconSizes(width, height) {
  const side = Math.max(width, height);
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter((size) => size <= side * 2);
  return sizes.length ? sizes : [Math.min(256, Math.max(1, side))];
}

/**
 * A Windows icon whose entries are PNG pictures (allowed since Windows Vista), smallest first.
 * @param {{ size: number, png: Uint8Array }[]} entries
 */
export function ico(entries) {
  const head = 6 + entries.length * 16;
  const total = head + entries.reduce((sum, e) => sum + e.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let at = head;
  entries.forEach(({ size, png }, k) => {
    const e = 6 + k * 16;
    // A side of 256 is written as 0.
    out[e] = size & 255;
    out[e + 1] = size & 255;
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, png.length, true);
    v.setUint32(e + 12, at, true);
    out.set(png, at);
    at += png.length;
  });
  return out;
}

/** The colour channels of RGBA pixels, without alpha. */
export function rgbOf(data) {
  const out = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    out[o] = data[i];
    out[o + 1] = data[i + 1];
    out[o + 2] = data[i + 2];
  }
  return out;
}

/** The alpha channel of RGBA pixels. */
export function alphaOf(data) {
  const out = new Uint8Array(data.length / 4);
  for (let i = 3, o = 0; i < data.length; i += 4, o++) out[o] = data[i];
  return out;
}

/** zlib-wrapped deflate, which a PDF's FlateDecode reads, from the browser's CompressionStream. */
export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A PDF of one page that holds the picture, as Kento's "fit the picture" layout without margins: the
 * page is the picture's size at 96 dpi, scaled down when a side would pass the 200-inch limit.
 * @param {{ width: number, height: number, image: Uint8Array, filter: 'DCTDecode' | 'FlateDecode',
 *   mask?: Uint8Array | null }} o the picture's pixels, its RGB stream (a JPEG, or deflated RGB) and,
 *   for a picture with transparency, its deflated alpha
 */
export function pdf({ width, height, image, filter, mask = null }) {
  const MAX = 14400;
  const natural = [(width * 72) / 96, (height * 72) / 96];
  const scale = Math.min(1, MAX / natural[0], MAX / natural[1]);
  const w = (natural[0] * scale).toFixed(2).replace(/\.?0+$/, '');
  const h = (natural[1] * scale).toFixed(2).replace(/\.?0+$/, '');
  const text = new TextEncoder();
  const out = bytesOut(image.length + (mask ? mask.length : 0) + 2048);
  const offsets = [];
  const put = (s) => out.bytes(text.encode(s));
  const object = (n, dict, stream) => {
    offsets[n] = out.size();
    put(`${n} 0 obj\n${dict}\n`);
    if (stream) {
      put('stream\n');
      out.bytes(stream);
      put('\nendstream\n');
    }
    put('endobj\n');
  };
  // The header, and a comment of bytes above 127 that marks the file as binary.
  out.bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const content = text.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${image.length}${mask ? ' /SMask 6 0 R' : ''} >>`,
    image,
  );
  object(5, `<< /Length ${content.length} >>`, content);
  if (mask) {
    object(
      6,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>`,
      mask,
    );
  }
  const count = offsets.length;
  const xref = out.size();
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  put(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return out.done();
}
