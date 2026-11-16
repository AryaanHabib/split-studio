// Three matching covers from ONE source frame. Red/Blue are colour treatments
// of the identical pixels (luminance-mapped duotone blended with the original),
// so framing, characters and background match exactly.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const TEAM = { red: { dark: [70, 6, 12], light: [255, 196, 190], label: '#e5383b' }, blue: { dark: [6, 22, 74], light: [190, 215, 255], label: '#2f6fed' } } as const;

function labelSvg(w: number, team: 'red' | 'blue', y: number) {
  const s = w / 1080; const text = `TEAM ${team.toUpperCase()}`; const tw = 330 * s, th = 76 * s;
  return Buffer.from(`<svg width="${w}" height="${Math.round(y + th + 10)}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${(w - tw) / 2}" y="${y}" rx="${th / 2}" width="${tw}" height="${th}" fill="${TEAM[team].label}"/>
    <text x="${w / 2}" y="${y + th * 0.68}" font-family="Inter" font-weight="900" font-size="${40 * s}" fill="#fff" text-anchor="middle" letter-spacing="${2 * s}">${text}</text></svg>`);
}

export async function makeCovers(source: string, outDir: string, opts: { label?: boolean; strength?: number } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const img = sharp(source).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const out: Record<string, string> = {};
  const mainP = path.join(outDir, 'cover_main.jpg');
  await sharp(data, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toFile(mainP); out.main = mainP;
  for (const team of ['red', 'blue'] as const) {
    const t = TEAM[team]; const k = opts.strength ?? 0.72;
    const o = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const yc = Math.min(1, Math.max(0, (y - 0.5) * 1.12 + 0.52)); // gentle contrast
      for (let c = 0; c < 3; c++) {
        const duo = (t.dark[c] + (t.light[c] - t.dark[c]) * yc) / 255;
        const orig = data[i + c] / 255;
        // keep near-whites and skin detail partly natural
        const w = k * (1 - 0.35 * Math.pow(y, 4));
        o[i + c] = Math.round(Math.min(1, orig * (1 - w) + duo * w) * 255);
      }
    }
    let pipe = sharp(o, { raw: { width: W, height: H, channels: 3 } });
    if (opts.label !== false) pipe = pipe.composite([{ input: labelSvg(W, team, Math.round(H * 0.16)), top: 0, left: 0 }]);
    const p = path.join(outDir, `cover_${team}.jpg`); await pipe.jpeg({ quality: 92 }).toFile(p); out[team] = p;
  }
  // profile-grid previews: Instagram/TikTok grids crop the centre to ~3:4
  const cropH = Math.round(W * 4 / 3); const top = Math.round((H - cropH) / 2);
  const tiles = await Promise.all(['main', 'red', 'blue'].map((k) => sharp(out[k]).extract({ left: 0, top, width: W, height: cropH }).resize(360, 480).toBuffer()));
  const grid = path.join(outDir, 'grid_preview_3x4.jpg');
  await sharp({ create: { width: 360 * 3 + 8, height: 480, channels: 3, background: '#ffffff' } }).composite(tiles.map((b, i) => ({ input: b, left: i * 364, top: 0 }))).jpeg({ quality: 88 }).toFile(grid);
  const full = await Promise.all(['main', 'red', 'blue'].map((k) => sharp(out[k]).resize(270, 480).toBuffer()));
  const grid2 = path.join(outDir, 'grid_preview_9x16.jpg');
  await sharp({ create: { width: 270 * 3 + 8, height: 480, channels: 3, background: '#ffffff' } }).composite(full.map((b, i) => ({ input: b, left: i * 274, top: 0 }))).jpeg({ quality: 88 }).toFile(grid2);
  out.grid3x4 = grid; out.grid9x16 = grid2;
  return out;
}
