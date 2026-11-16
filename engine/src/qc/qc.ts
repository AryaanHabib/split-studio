// Technical quality control on rendered files (ffprobe/ffmpeg based).
// These are objective checks. Creative quality still needs human review.
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../render/render';
import type { CompiledVideo } from '../shared/types';

export interface QcCheck { name: string; ok: boolean; detail: string; level: 'error' | 'warning' }

export async function qcVideo(file: string, video: CompiledVideo, sheetOut?: string): Promise<QcCheck[]> {
  const C: QcCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, level: 'error' | 'warning' = 'error') => C.push({ name, ok, detail, level });
  if (!fs.existsSync(file)) { add('file exists', false, file); return C; }
  add('file exists', true, `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { capture: true }));
  const v = probe.streams.find((s: any) => s.codec_type === 'video'); const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  add('video stream', !!v, v ? `${v.codec_name} ${v.profile} ${v.pix_fmt}` : 'missing');
  if (v) {
    add('dimensions 1080x1920', v.width === video.width && v.height === video.height, `${v.width}x${v.height}`);
    add('aspect 9:16', Math.abs(v.width / v.height - 9 / 16) < 0.002, (v.width / v.height).toFixed(4));
    add('codec h264 yuv420p', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.codec_name}/${v.pix_fmt}`);
    const fr = v.r_frame_rate.split('/').map(Number); add('frame rate', Math.abs(fr[0] / fr[1] - video.fps) < 0.01, `${(fr[0] / fr[1]).toFixed(2)} fps`);
  }
  add('audio stream', !!a, a ? `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch` : 'missing');
  const dur = parseFloat(probe.format.duration);
  add('duration matches edit', Math.abs(dur - video.duration) < 0.15, `${dur.toFixed(2)}s vs ${video.duration.toFixed(2)}s planned`);
  // decode the whole file: catches corruption / broken frames
  const dec = await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { capture: true }).then(() => '').catch((e) => String(e));
  add('decodes cleanly', dec === '', dec ? dec.slice(0, 300) : 'no decoder errors');
  // black frames + frozen segments
  const bd = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.4:pix_th=0.06,freezedetect=n=0.0008:d=2.5', '-an', '-f', 'null', '-'], { capture: true, stderr: true }).catch((e) => String(e));
  const blacks = [...String(bd).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${m[1]}-${m[2]}s`);
  add('no unintended black sections', blacks.length === 0, blacks.length ? blacks.join(', ') : 'none', 'warning');
  const freezes = [...String(bd).matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}s for ${(+m[2]).toFixed(1)}s`);
  add('no frozen picture > 2.5s', freezes.length === 0, freezes.length ? freezes.join(', ') : 'none', 'warning');
  // silence + loudness
  const sd = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-50dB:d=1.5,ebur128=peak=true', '-vn', '-f', 'null', '-'], { capture: true, stderr: true }).catch((e) => String(e));
  const sil = [...String(sd).matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}-${(+m[2]).toFixed(1)}s`);
  add('no unwanted silence > 1.5s', sil.length === 0, sil.length ? sil.join(', ') : 'none', 'warning');
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(String(sd).split('Summary:').pop() ?? ''); const tp = /Peak:\s+(-?[\d.]+) dBFS/.exec(String(sd).split('Summary:').pop() ?? '');
  add('loudness ≈ -14 LUFS', !!I && Math.abs(parseFloat(I[1]) + 14) < 2, I ? `${I[1]} LUFS, true peak ${tp?.[1]} dBFS` : 'n/a', 'warning');
  // shot cut points exist where planned (scene-change detection is advisory for cuts between similar shots)
  add('shot count', video.shots.length > 1, `${video.shots.length} planned shots`, 'warning');
  // representative frames: one per shot (mid-shot) for human / model inspection
  if (sheetOut) {
    const dir = sheetOut + '_frames'; fs.mkdirSync(dir, { recursive: true });
    const frames: string[] = [];
    for (const s of video.shots) {
      const t = (s.start + s.end) / 2; const f = path.join(dir, `shot${String(s.index + 1).padStart(2, '0')}.jpg`);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=270:480', f]); frames.push(f);
    }
    const cols = 6; const rows = Math.ceil(frames.length / cols);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'shot%02d.jpg'), '-vf', `tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', sheetOut]);
    add('contact sheet', fs.existsSync(sheetOut), sheetOut, 'warning');
  }
  return C;
}
