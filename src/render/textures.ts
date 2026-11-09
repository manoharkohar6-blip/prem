import * as THREE from 'three';
import { mulberry32 } from '../game/rng';

export interface GrungeOptions {
  base: string;
  dark: string;
  light: string;
  size?: number;
  blobs?: number;
  bricks?: boolean;
  planks?: boolean;
  seed?: number;
  repeat?: [number, number];
}

/**
 * Procedurally painted grunge map. Keeps the project asset-free while still
 * giving walls, floors and props a gritty, hand-worn look.
 */
export function grungeTexture(options: GrungeOptions): THREE.CanvasTexture {
  const size = options.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(options.seed ?? 1337);

  ctx.fillStyle = options.base;
  ctx.fillRect(0, 0, size, size);

  // Mottled damp patches.
  const blobs = options.blobs ?? 140;
  for (let i = 0; i < blobs; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 4 + rng() * (size / 7);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const useDark = rng() > 0.45;
    gradient.addColorStop(0, useDark ? options.dark : options.light);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.1 + rng() * 0.28;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Water streaks running down.
  for (let i = 0; i < 26; i += 1) {
    const x = rng() * size;
    const w = 1 + rng() * 3;
    const h = size * (0.15 + rng() * 0.5);
    const y = rng() * (size - h);
    ctx.fillStyle = options.dark;
    ctx.globalAlpha = 0.06 + rng() * 0.14;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;

  if (options.bricks) {
    const rowHeight = size / 10;
    const brickWidth = size / 5;
    ctx.strokeStyle = options.dark;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    for (let row = 0; row < 10; row += 1) {
      const y = row * rowHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let col = -1; col < 6; col += 1) {
        const x = col * brickWidth + offset;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowHeight);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  if (options.planks) {
    const plankWidth = size / 6;
    ctx.strokeStyle = options.dark;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 3;
    for (let i = 0; i <= 6; i += 1) {
      const x = i * plankWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 60; i += 1) {
      ctx.fillStyle = options.light;
      ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 14, 1);
    }
    ctx.globalAlpha = 1;
  }

  // Fine grit.
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + n));
    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + n));
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
  return texture;
}

/** Soft radial sprite used for pickup glows and Mundiya's distortion aura. */
export function glowTexture(inner = 'rgba(255,240,210,1)', outer = 'rgba(255,180,80,0)'): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, inner.replace('1)', '0.45)'));
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Splatter decal for chapel graffiti and mortuary walls. */
export function graffitiTexture(seed = 7): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 12, 16, 0.85)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  // A crude sigil.
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = size / 2 + Math.cos(angle) * 70;
    const y = size / 2 + Math.sin(angle) * 70;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  for (let i = 0; i < 40; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(${90 + rng() * 60}, 8, 12, ${0.15 + rng() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rng() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
