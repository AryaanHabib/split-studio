// npm run setup:python: installs the voice packages into the same Python the studio will run.
import { execFileSync } from 'node:child_process';
const py = process.env.STUDIO_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
console.log(`Using ${py}: ${execFileSync(py, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()}`);
execFileSync(py, ['-m', 'pip', 'install', 'kokoro-onnx', 'soundfile', 'numpy'], { stdio: 'inherit' });
execFileSync(py, ['-c', 'import kokoro_onnx, soundfile, numpy; print("voice packages OK")'], { stdio: 'inherit' });
