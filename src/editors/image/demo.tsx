// SPDX-License-Identifier: MIT
// Browser previews and screenshots of the image editors with the in-memory stand-in (no Tauri): in a
// page served by Vite, import('/src/editors/image/demo.tsx').then((demo) => demo.mountImageEditorDemo('markup')).
// The stand-in has no image engine, so this module paints a sample photo and rough previews of the
// tools on a canvas. They only stand in for the engine's pictures; the engine draws the real ones.
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api, type Area, type CollageStyle, type FrameStyle, type Hide, type ImageTool, type Rgb } from '../../ipc';
import { ImageEditor, type ImagePanel } from '.';

const PHOTOS = [
  'C:\\Users\\me\\Pictures\\Kapadokya 🎈.jpg',
  'C:\\Users\\me\\Pictures\\Göreme gün batımı.jpg',
  'C:\\Users\\me\\Pictures\\Uçhisar.png',
  'C:\\Users\\me\\Pictures\\Peribacaları.webp',
];
/** What the stand-in's imageInfo answers for every picture. */
const SOURCE = { width: 4032, height: 3024 };

const SKIES: [string, string, string][] = [
  ['#7d9fe0', '#f2c9a9', '#f8e6c8'],
  ['#41497a', '#d9837a', '#f4c18f'],
  ['#8ec5ea', '#cfe6f2', '#f1efe6'],
  ['#5c7fc2', '#e8b7a8', '#f6dcc0'],
];
const BALLOONS = ['#e5392f', '#fdd835', '#1e88e5', '#43a047', '#f57c00', '#8e24aa'];

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return { element, g: element.getContext('2d')! };
}

const rgb = (color: Rgb) => `rgb(${color.join(' ')})`;

/** A valley at dawn with fairy chimneys and balloons; `variant` changes the light and the balloons. */
function scene(width: number, height: number, variant = 0): HTMLCanvasElement {
  const { element, g } = canvas(width, height);
  const w = element.width;
  const h = element.height;
  const [top, middle, low] = SKIES[variant % SKIES.length]!;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.75);
  sky.addColorStop(0, top);
  sky.addColorStop(0.6, middle);
  sky.addColorStop(1, low);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.7, h * 0.46, 0, w * 0.7, h * 0.46, w * 0.16);
  sun.addColorStop(0, 'rgba(255, 246, 220, 1)');
  sun.addColorStop(0.3, 'rgba(255, 236, 200, 0.75)');
  sun.addColorStop(1, 'rgba(255, 236, 200, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  const hill = (base: number, lift: number, color: string, seed: number) => {
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, h * base);
    for (let i = 0; i <= 8; i++) {
      const x = (w * i) / 8;
      const y = h * (base - lift * (0.5 + 0.5 * Math.sin(i * 1.7 + seed)));
      g.quadraticCurveTo(x - w / 16, y - h * 0.03, x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  hill(0.68, 0.06, '#d8b9a6', variant);
  hill(0.78, 0.05, '#bf9784', variant + 2);
  // Fairy chimneys: cones with darker caps.
  for (let i = 0; i < 7; i++) {
    const x = w * (0.08 + i * 0.13 + 0.03 * Math.sin(i * 3 + variant));
    const tall = h * (0.12 + 0.05 * Math.abs(Math.sin(i * 2.3 + variant)));
    const base = h * 0.84;
    g.beginPath();
    g.moveTo(x - w * 0.035, base);
    g.quadraticCurveTo(x - w * 0.012, base - tall * 0.6, x, base - tall);
    g.quadraticCurveTo(x + w * 0.012, base - tall * 0.6, x + w * 0.035, base);
    g.closePath();
    g.fillStyle = '#e3c9b4';
    g.fill();
    g.beginPath();
    g.ellipse(x, base - tall, w * 0.014, h * 0.012, 0, 0, Math.PI * 2);
    g.fillStyle = '#8c6d61';
    g.fill();
  }
  hill(0.9, 0.03, '#9a7a6c', variant + 4);
  for (let i = 0; i < 5; i++) {
    const x = w * (0.12 + i * 0.19 + 0.04 * Math.cos(i + variant));
    const y = h * (0.16 + 0.1 * Math.abs(Math.sin(i * 1.3 + variant)));
    const r = w * (0.035 - i * 0.003);
    g.beginPath();
    g.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
    g.fillStyle = BALLOONS[(i + variant) % BALLOONS.length]!;
    g.fill();
    g.beginPath();
    g.ellipse(x, y, r * 0.38, r * 1.15, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fill();
    g.strokeStyle = 'rgba(60, 40, 30, 0.7)';
    g.lineWidth = Math.max(1, r * 0.04);
    g.beginPath();
    g.moveTo(x - r * 0.5, y + r * 0.95);
    g.lineTo(x - r * 0.18, y + r * 1.55);
    g.moveTo(x + r * 0.5, y + r * 0.95);
    g.lineTo(x + r * 0.18, y + r * 1.55);
    g.stroke();
    g.fillStyle = '#6b4a3a';
    g.fillRect(x - r * 0.2, y + r * 1.55, r * 0.4, r * 0.3);
  }
  return element;
}

const fitIn = (width: number, height: number, side: number) => {
  const k = Math.min(1, side / Math.max(width, height));
  return { width: width * k, height: height * k, k };
};

function edit(tool: Extract<ImageTool, { tool: 'edit-image' }>, size: number) {
  const { adjust } = tool;
  const quarter = adjust.turn === 'left' || adjust.turn === 'right';
  const turned = quarter ? { width: SOURCE.height, height: SOURCE.width } : SOURCE;
  const target = adjust.resize ? { width: adjust.resize[0], height: adjust.resize[1] } : turned;
  const out = fitIn(target.width, target.height, size);
  const { element, g } = canvas(out.width, out.height);
  const picture = scene(quarter ? out.height : out.width, quarter ? out.width : out.height);
  g.filter = `brightness(${1 + adjust.brightness / 100}) contrast(${1 + adjust.contrast / 100}) saturate(${1 + adjust.saturation / 100})`;
  g.translate(element.width / 2, element.height / 2);
  g.scale(adjust.flipHorizontal ? -1 : 1, adjust.flipVertical ? -1 : 1);
  g.rotate({ none: 0, right: 90, half: 180, left: -90 }[adjust.turn] * (Math.PI / 180));
  g.drawImage(picture, -picture.width / 2, -picture.height / 2);
  return element;
}

function frame(style: FrameStyle, size: number) {
  const out = fitIn(SOURCE.width + 2 * style.padding, SOURCE.height + 2 * style.padding, size);
  const { element, g } = canvas(out.width, out.height);
  const pad = style.padding * out.k;
  const picture = scene(SOURCE.width * out.k, SOURCE.height * out.k);
  const back = style.background;
  if (back.kind === 'color') {
    g.fillStyle = rgb(back.rgb);
    g.fillRect(0, 0, element.width, element.height);
  } else if (back.kind === 'gradient') {
    const angle = (back.angle * Math.PI) / 180;
    const cx = element.width / 2;
    const cy = element.height / 2;
    const reach = (Math.abs(Math.cos(angle)) * element.width + Math.abs(Math.sin(angle)) * element.height) / 2;
    const fill = g.createLinearGradient(
      cx - Math.cos(angle) * reach,
      cy - Math.sin(angle) * reach,
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach,
    );
    fill.addColorStop(0, rgb(back.from));
    fill.addColorStop(1, rgb(back.to));
    g.fillStyle = fill;
    g.fillRect(0, 0, element.width, element.height);
  } else {
    g.filter = `blur(${Math.max(4, element.width / 60)}px)`;
    g.drawImage(picture, -pad, -pad, element.width + 2 * pad, element.height + 2 * pad);
    g.filter = 'none';
  }
  const radius = style.radius * out.k;
  const path = new Path2D();
  path.roundRect(pad, pad, picture.width, picture.height, radius);
  if (style.shadow) {
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.35)';
    g.shadowBlur = Math.max(6, pad * 0.5);
    g.shadowOffsetY = Math.max(2, pad * 0.15);
    g.fillStyle = '#000';
    g.fill(path);
    g.restore();
  }
  g.save();
  g.clip(path);
  g.drawImage(picture, pad, pad);
  g.restore();
  return element;
}

function redact(areas: Area[], hide: Hide, size: number) {
  const out = fitIn(SOURCE.width, SOURCE.height, size);
  const picture = scene(out.width, out.height);
  const { element, g } = canvas(out.width, out.height);
  g.drawImage(picture, 0, 0);
  for (const area of areas) {
    const [x, y, w, h] = [area.x * out.k, area.y * out.k, area.width * out.k, area.height * out.k];
    if (hide.kind === 'color') {
      g.fillStyle = rgb(hide.rgb);
      g.fillRect(x, y, w, h);
      continue;
    }
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    if (hide.kind === 'blur') {
      g.filter = `blur(${Math.max(6, w / 12)}px)`;
      g.drawImage(picture, 0, 0);
    } else {
      const cell = Math.max(6, Math.min(w, h) / 8);
      const small = canvas(w / cell, h / cell);
      small.g.drawImage(picture, x, y, w, h, 0, 0, small.element.width, small.element.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(small.element, x, y, w, h);
    }
    g.restore();
  }
  return element;
}

function collage(variants: number[], style: CollageStyle, size: number) {
  const n = variants.length;
  const columns = style.layout.kind === 'grid' ? style.layout.columns : style.layout.kind === 'row' ? n : 1;
  const rows = Math.ceil(n / columns);
  const gap = style.spacing;
  // The width is the whole result's, spacing at the edges included, in every layout.
  const cell = (style.width - gap * (columns + 1)) / columns;
  const tall = (cell * 3) / 4;
  const height = rows * tall + gap * (rows + 1);
  const out = fitIn(style.width, height, size);
  const { element, g } = canvas(out.width, out.height);
  g.fillStyle = rgb(style.background);
  g.fillRect(0, 0, element.width, element.height);
  variants.forEach((variant, i) => {
    const x = (gap + (i % columns) * (cell + gap)) * out.k;
    const y = (gap + Math.floor(i / columns) * (tall + gap)) * out.k;
    // Every second sample is upright, so fill and fit look different.
    const upright = i % 2 === 1;
    const picture = upright
      ? scene(tall * 0.75 * out.k, tall * out.k, variant)
      : scene(cell * out.k, tall * out.k, variant);
    const k = (style.fill ? Math.max : Math.min)((cell * out.k) / picture.width, (tall * out.k) / picture.height);
    const w = picture.width * k;
    const h = picture.height * k;
    g.save();
    g.beginPath();
    g.rect(x, y, cell * out.k, tall * out.k);
    g.clip();
    g.drawImage(picture, x + (cell * out.k - w) / 2, y + (tall * out.k - h) / 2, w, h);
    g.restore();
  });
  return element;
}

function draw(paths: string[], tool: ImageTool | null, size: number): HTMLCanvasElement {
  const variant = (path: string | undefined) => Math.max(0, PHOTOS.indexOf(path ?? ''));
  switch (tool?.tool) {
    case 'edit-image':
      return edit(tool, size);
    case 'frame':
      return frame(tool.frame, size);
    case 'redact-image':
      return redact(tool.areas, tool.hide, size);
    case 'collage':
      return collage(paths.map(variant), tool.collage, size);
    default: {
      const out = fitIn(SOURCE.width, SOURCE.height, size);
      return scene(out.width, out.height, variant(paths[0]));
    }
  }
}

let root: Root | null = null;

export function mountImageEditorDemo(tool: ImagePanel): void {
  api.imagePreview = (paths, request, size) =>
    new Promise((resolve) => draw(paths, request, Math.min(Math.max(size, 64), 2048)).toBlob(resolve, 'image/png'));
  let host = document.getElementById('image-editor-demo');
  if (!host) {
    host = document.createElement('div');
    host.id = 'image-editor-demo';
    document.body.append(host);
  }
  root?.unmount();
  const current = createRoot(host);
  root = current;
  const paths = tool === 'collage' ? PHOTOS : [PHOTOS[0]!];
  current.render(
    <StrictMode>
      <ImageEditor tool={tool} paths={paths} onClose={() => current.unmount()} onStarted={() => {}} />
    </StrictMode>,
  );
}
