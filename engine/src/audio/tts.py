"""Local TTS worker (Kokoro-82M, Apache-2.0) — no network, no paid API.

Reads a JSON list of {key, text, voice, speed} on stdin, writes WAVs into
--out and prints a JSON map {key: {file, dur, env}} on stdout. `env` is a
30 Hz mouth-openness envelope (0..1) derived from the audio, used to animate
character mouths in sync with the speech.

Existing files are reused (cache by content hash), so re-running is cheap.
"""
import argparse, json, os, sys
try:
    import numpy as np
    import soundfile as sf
    import kokoro_onnx  # noqa: F401  (imported lazily below; checked here so setup problems are reported clearly)
except ModuleNotFoundError as e:
    print(f"\nMissing Python package '{e.name}' for the Python running the studio:\n  {sys.executable}\n"
          f"Install the voice packages into THIS Python with:\n  \"{sys.executable}\" -m pip install kokoro-onnx soundfile numpy\n"
          f"(or run: npm run setup:python)\n", file=sys.stderr)
    sys.exit(2)

def envelope(samples: np.ndarray, sr: int, fps: int = 30) -> list:
    hop = sr // fps
    n = max(1, len(samples) // hop)
    rms = np.array([np.sqrt(np.mean(samples[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    if rms.max() > 0:
        rms = rms / np.percentile(rms, 95)
    rms = np.clip(rms, 0, 1)
    # gate silence, shape for visible flaps
    out = np.where(rms < 0.12, 0.0, np.power(rms, 0.7))
    return [round(float(x), 3) for x in out]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    args = ap.parse_args()
    lines = json.load(sys.stdin)
    os.makedirs(args.out, exist_ok=True)
    kokoro = None
    result = {}
    for ln in lines:
        path = os.path.join(args.out, f"{ln['key']}.wav")
        if not os.path.exists(path):
            if kokoro is None:
                from kokoro_onnx import Kokoro
                kokoro = Kokoro(args.model, args.voices)
            samples, sr = kokoro.create(ln['text'], voice=ln['voice'], speed=float(ln.get('speed', 1.0)), lang='en-us')
            # trim leading/trailing silence, keep a short tail
            nz = np.where(np.abs(samples) > 0.01)[0]
            if len(nz):
                samples = samples[max(0, nz[0] - int(0.03 * sr)): min(len(samples), nz[-1] + int(0.08 * sr))]
            sf.write(path, samples, sr)
            print(f"tts: {ln['key']} <- {ln['text'][:60]}", file=sys.stderr)
        data, sr = sf.read(path, dtype='float32')
        if data.ndim > 1:
            data = data.mean(axis=1)
        result[ln['key']] = {'file': path, 'dur': round(len(data) / sr, 3), 'env': envelope(data, sr)}
    json.dump(result, sys.stdout)

if __name__ == '__main__':
    main()
