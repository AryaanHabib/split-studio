// Live, interactive shot preview inside the website: the same runtime that renders final frames,
// running in the browser (real-time on a GPU, slower on software WebGL).
import '../engine/src/runtime/main';
const q = new URLSearchParams(location.search);
const ep = q.get('ep')!, vid = q.get('video') ?? 'main', scale = Number(q.get('scale') ?? 0.5);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const studio = (window as any).studio;
(async () => {
  const status = $('#status');
  try {
    const r = await fetch(`/api/files/productions/${ep}/compiled/${vid}.json?ts=${Date.now()}`);
    if (!r.ok) { status.textContent = 'No compiled preview yet. Click "Compile preview" in the studio.'; return; }
    const v = await r.json();
    status.textContent = 'Loading scene…';
    await studio.load(v, '/api/files/assets', scale);
    const cv: HTMLCanvasElement = studio.canvas(); cv.id = 'view'; $('#stage').appendChild(cv);
    const audio = new Audio(`/api/files/productions/${ep}/audio/${vid}_mix.wav`); let hasAudio = true; audio.onerror = () => { hasAudio = false; };
    const range = $('#scrub') as HTMLInputElement; range.max = String(v.duration); range.step = '0.01';
    const marks = $('#marks'); marks.innerHTML = v.shots.map((s: any) => `<span title="${s.id}" style="left:${(s.start / v.duration) * 100}%"></span>`).join('');
    let T = Number(q.get('t') ?? 0), playing = false, last = 0, busy = false;
    const show = () => { const sh = v.shots.find((s: any) => T >= s.start && T < s.end) ?? v.shots[v.shots.length - 1]; status.textContent = `${T.toFixed(2)}s / ${v.duration.toFixed(1)}s · shot ${sh.index + 1} "${sh.id}"`; range.value = String(T); };
    const draw = () => { if (busy) return; busy = true; studio.draw(T); show(); busy = false; };
    const tick = (now: number) => {
      if (playing) { const dt = Math.min(0.25, (now - last) / 1000); T += dt; if (T >= v.duration) { T = v.duration - 0.001; playing = false; audio.pause(); $('#play').textContent = '▶'; } draw(); }
      last = now; requestAnimationFrame(tick);
    };
    $('#play').onclick = () => { playing = !playing; $('#play').textContent = playing ? '❚❚' : '▶'; if (hasAudio) { audio.currentTime = T; playing ? audio.play().catch(() => {}) : audio.pause(); } };
    range.oninput = () => { T = Number(range.value); if (hasAudio) audio.currentTime = T; draw(); };
    window.addEventListener('message', (e) => { if (e.data?.seek !== undefined) { T = e.data.seek; if (hasAudio) audio.currentTime = T; draw(); } });
    draw(); requestAnimationFrame(tick);
  } catch (e: any) { status.textContent = 'Preview error: ' + e.message; }
})();
