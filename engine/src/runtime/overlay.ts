// 2D overlay layer composited over each rendered frame: titles, scoreboards,
// name labels, captions, decision cards, flashes and fades. Positioned inside
// short-form safe areas (top ~12%, bottom ~22%, right ~8% are covered by platform UI).
import type { OverlayItem } from '../shared/types';

export const SAFE = { top: 0.115, bottom: 0.78, left: 0.07, right: 0.88 };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u), 3);
const TEAM: Record<string, string> = { red: '#e5383b', blue: '#2f6fed' };

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const test = cur ? cur + ' ' + w : w; if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur); return lines;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function strokedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill = '#fff', stroke = 'rgba(0,0,0,0.85)', sw = 10) {
  g.lineJoin = 'round'; g.lineWidth = sw; g.strokeStyle = stroke; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
}

export function drawOverlays(g: CanvasRenderingContext2D, W: number, H: number, T: number, items: OverlayItem[], project: (target: any) => { x: number; y: number; visible: boolean } | null) {
  const S = W / 1080; // design at 1080 wide
  for (const it of items) {
    if (T < it.t0 || T >= it.t1) continue;
    const lt = T - it.t0, rem = it.t1 - T;
    const inA = easeOut(lt / 0.18), outA = clamp(rem / 0.15);
    const a = Math.min(inA, outA);
    const p = it.p;
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    switch (it.kind) {
      case 'title': {
        const y = (p.y ?? 0.2) * H; const size = (p.size ?? 92) * S;
        g.globalAlpha = a; g.translate(W / 2, y); const sc = 0.92 + 0.08 * inA; g.scale(sc, sc);
        g.font = `900 ${size}px Inter`;
        const lines = wrap(g, p.text.toUpperCase(), W * 0.8);
        lines.forEach((l, i) => strokedText(g, l, 0, (i - (lines.length - 1) / 2) * size * 1.02, p.color ?? '#fff', 'rgba(0,0,0,0.9)', size * 0.16));
        if (p.sub) { g.font = `800 ${size * 0.42}px Inter`; strokedText(g, p.sub, 0, (lines.length / 2) * size * 1.02 + size * 0.35, p.subColor ?? '#ffd166', 'rgba(0,0,0,0.9)', size * 0.09); }
        break;
      }
      case 'score': {
        const y = SAFE.top * H + 28 * S; const w = 640 * S, h = 92 * S; const x = W / 2 - w / 2;
        g.globalAlpha = a;
        g.fillStyle = 'rgba(14,16,20,0.86)'; roundRect(g, x, y, w, h, 18 * S); g.fill();
        const L = p.left, R = p.right;
        g.fillStyle = L.color ?? '#f4a261'; roundRect(g, x, y, 10 * S, h, 4 * S); g.fill();
        g.fillStyle = R.color ?? '#8ecae6'; roundRect(g, x + w - 10 * S, y, 10 * S, h, 4 * S); g.fill();
        g.font = `800 ${30 * S}px Inter`; g.fillStyle = '#e9ecef';
        g.textAlign = 'left'; g.fillText(L.name, x + 30 * S, y + h / 2); g.textAlign = 'right'; g.fillText(R.name, x + w - 30 * S, y + h / 2);
        g.textAlign = 'center'; g.font = `900 ${50 * S}px Inter`;
        const pop = (v: any, changedAt?: number) => { const d = changedAt !== undefined ? T - changedAt : 9; return 1 + 0.35 * Math.max(0, 1 - d / 0.35); };
        g.save(); g.translate(W / 2 - 62 * S, y + h / 2 + 2 * S); const s1 = pop(L.value, L.changedAt); g.scale(s1, s1); g.fillStyle = '#fff'; g.fillText(String(L.value), 0, 0); g.restore();
        g.fillStyle = '#6c757d'; g.fillText('–', W / 2, y + h / 2);
        g.save(); g.translate(W / 2 + 62 * S, y + h / 2 + 2 * S); const s2 = pop(R.value, R.changedAt); g.scale(s2, s2); g.fillStyle = '#fff'; g.fillText(String(R.value), 0, 0); g.restore();
        if (p.note) { g.font = `800 ${24 * S}px Inter`; g.fillStyle = p.noteColor ?? '#ffd166'; g.fillText(p.note, W / 2, y + h + 30 * S); }
        break;
      }
      case 'label': {
        const pr = project(p.target); if (!pr || !pr.visible) break;
        const x = clamp(pr.x, 120 * S, W - 180 * S), y = clamp(pr.y - (p.lift ?? 60) * S, SAFE.top * H + 40 * S, SAFE.bottom * H);
        g.globalAlpha = a; g.font = `900 ${(p.size ?? 34) * S}px Inter`;
        const tw = g.measureText(p.text).width + 34 * S, th = (p.size ?? 34) * 1.6 * S;
        g.fillStyle = p.bg ?? '#ffd166'; roundRect(g, x - tw / 2, y - th, tw, th, 10 * S); g.fill();
        g.beginPath(); g.moveTo(x - 12 * S, y); g.lineTo(x + 12 * S, y); g.lineTo(x, y + 16 * S); g.closePath(); g.fill();
        g.fillStyle = p.color ?? '#111'; g.fillText(p.text, x, y - th / 2 + 1 * S);
        if (p.sub) { g.font = `700 ${22 * S}px Inter`; strokedText(g, p.sub, x, y - th - 20 * S, '#fff', 'rgba(0,0,0,0.8)', 6 * S); }
        break;
      }
      case 'caption': {
        const size = (p.size ?? 50) * S; g.font = `800 ${size}px Inter`;
        const lines = wrap(g, p.text, W * 0.78); const lh = size * 1.18;
        const yb = (p.y ?? 0.70) * H;
        g.globalAlpha = Math.min(clamp(lt / 0.08), outA);
        lines.forEach((l, i) => strokedText(g, l, W / 2, yb + (i - (lines.length - 1)) * lh, p.color ?? '#fff', 'rgba(0,0,0,0.9)', size * 0.2));
        if (p.speaker) { g.font = `800 ${size * 0.5}px Inter`; strokedText(g, p.speaker.toUpperCase(), W / 2, yb - lines.length * lh - size * 0.05, p.speakerColor ?? '#ffd166', 'rgba(0,0,0,0.9)', size * 0.1); }
        break;
      }
      case 'choice': {
        // decision card: dims the frame, question + two team panels
        g.globalAlpha = clamp(lt / 0.3) * outA * 0.55; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
        const qy = H * 0.24; g.globalAlpha = easeOut(lt / 0.3) * outA;
        g.font = `900 ${64 * S}px Inter`; const ql = wrap(g, (p.question ?? 'WHAT SHOULD HAPPEN?').toUpperCase(), W * 0.82);
        ql.forEach((l, i) => strokedText(g, l, W / 2, qy + i * 72 * S, '#fff', 'rgba(0,0,0,0.9)', 12 * S));
        const panel = (team: 'red' | 'blue', text: string, idx: number) => {
          const d = lt - 0.35 - idx * 0.25; const k = easeOut(d / 0.3); if (d < 0) return;
          const w = W * 0.8, h = 250 * S, x = W / 2 - w / 2 + (1 - k) * (idx ? 1 : -1) * 80 * S, y = H * (0.38 + idx * 0.19);
          g.globalAlpha = k * outA; g.fillStyle = TEAM[team]; roundRect(g, x, y, w, h, 26 * S); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(g, x + 8 * S, y + 8 * S, w - 16 * S, 70 * S, 20 * S); g.fill();
          g.fillStyle = '#fff'; g.font = `900 ${44 * S}px Inter`; g.fillText(`TEAM ${team.toUpperCase()}`, W / 2 + (x - (W / 2 - w / 2)), y + 46 * S);
          g.font = `800 ${46 * S}px Inter`; const tl = wrap(g, text.toUpperCase(), w * 0.86);
          tl.forEach((l, i) => g.fillText(l, W / 2 + (x - (W / 2 - w / 2)), y + 140 * S + (i - (tl.length - 1) / 2) * 54 * S));
        };
        panel('red', p.red, 0); panel('blue', p.blue, 1);
        if (p.footer && lt > 1.2) { g.globalAlpha = easeOut((lt - 1.2) / 0.3) * outA; g.font = `800 ${34 * S}px Inter`; strokedText(g, p.footer, W / 2, H * 0.79, '#fff', 'rgba(0,0,0,0.9)', 8 * S); }
        break;
      }
      case 'card': {
        g.globalAlpha = a * (p.dim ?? 0.5); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = a;
        const size = (p.size ?? 110) * S; g.font = `900 ${size}px Inter`;
        const lines = wrap(g, p.text.toUpperCase(), W * 0.84); const y0 = (p.y ?? 0.42) * H;
        g.translate(W / 2, y0); const sc = 0.85 + 0.15 * inA; g.scale(sc, sc);
        lines.forEach((l, i) => strokedText(g, l, 0, (i - (lines.length - 1) / 2) * size * 1.0, p.color ?? '#fff', 'rgba(0,0,0,0.9)', size * 0.14));
        if (p.sub) { g.font = `800 ${size * 0.38}px Inter`; const sl = wrap(g, p.sub, W * 0.8); sl.forEach((l, i) => strokedText(g, l, 0, (lines.length / 2) * size + size * 0.25 + i * size * 0.45, p.subColor ?? '#ffd166', 'rgba(0,0,0,0.9)', size * 0.08)); }
        break;
      }
      case 'tag': {
        const y = p.pos === 'bottom' ? SAFE.bottom * H - 40 * S : SAFE.top * H + 40 * S;
        g.globalAlpha = a; g.font = `800 ${30 * S}px Inter`; const tw = g.measureText(p.text).width + 40 * S;
        g.fillStyle = p.bg ?? 'rgba(0,0,0,0.7)'; roundRect(g, W / 2 - tw / 2, y - 26 * S, tw, 52 * S, 26 * S); g.fill(); g.fillStyle = p.color ?? '#fff'; g.fillText(p.text, W / 2, y + 1 * S);
        break;
      }
      case 'counter': {
        const x = W * (p.x ?? 0.5), y = H * (p.y ?? 0.2); g.globalAlpha = a;
        g.font = `800 ${30 * S}px Inter`; strokedText(g, (p.label ?? '').toUpperCase(), x, y - 46 * S, '#fff', 'rgba(0,0,0,0.85)', 7 * S);
        g.font = `900 ${84 * S}px Inter`; const d = p.changedAt !== undefined ? T - p.changedAt : 9; const sc = 1 + 0.3 * Math.max(0, 1 - d / 0.3);
        g.translate(x, y + 20 * S); g.scale(sc, sc); strokedText(g, String(p.value), 0, 0, p.color ?? '#ffd166', 'rgba(0,0,0,0.9)', 14 * S);
        break;
      }
      case 'flash': { g.globalAlpha = (p.alpha ?? 0.9) * (1 - clamp(lt / (it.t1 - it.t0))); g.fillStyle = p.color ?? '#fff'; g.fillRect(0, 0, W, H); break; }
      case 'fade': { const k = clamp(lt / (it.t1 - it.t0)); const from = p.from ?? 1, to = p.to ?? 0; g.globalAlpha = from + (to - from) * k; g.fillStyle = p.color ?? '#000'; g.fillRect(0, 0, W, H); break; }
      case 'letterbox': { const h = H * (p.size ?? 0.06) * inA; g.fillStyle = '#000'; g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h); break; }
    }
    g.restore();
  }
}

export function drawGrade(g: CanvasRenderingContext2D, W: number, H: number, grade: Record<string, any> = {}) {
  const v = grade.vignette ?? 0.35;
  if (v > 0) {
    const r = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, `rgba(0,0,0,${v})`); g.fillStyle = r; g.fillRect(0, 0, W, H);
  }
  if (grade.tint) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = grade.tint; g.globalAlpha = grade.tintAmount ?? 0.25; g.fillRect(0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  if (grade.grain) {
    // cheap deterministic grain: a few hundred translucent specks
    const n = Math.floor(grade.grain * 900); g.fillStyle = 'rgba(255,255,255,0.05)';
    let s = (grade.frame ?? 0) * 9301 + 49297;
    for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; const x = (s / 233280) * W; s = (s * 9301 + 49297) % 233280; const y = (s / 233280) * H; g.fillRect(x, y, 2, 2); }
  }
}
