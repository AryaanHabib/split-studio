"""Pack Kokoro voice tensors (.pt zip archives) into voices.npz WITHOUT unpickling.
Each .pt is a zip whose data/0 entry is the raw float32 tensor (510 x 1 x 256)."""
import sys, os, glob, zipfile
import numpy as np

src, out = sys.argv[1], sys.argv[2]
voices = {}
for f in sorted(glob.glob(os.path.join(src, '*.pt'))):
    z = zipfile.ZipFile(f)
    entry = [n for n in z.namelist() if n.endswith('/data/0')]
    if not entry:
        print('skip (unexpected layout):', f); continue
    a = np.frombuffer(z.read(entry[0]), dtype='<f4')
    if a.size != 510 * 256:
        print('skip (unexpected size):', f, a.size); continue
    voices[os.path.basename(f)[:-3]] = a.reshape(510, 1, 256)
np.savez(out, **voices)
print('voices:', ', '.join(sorted(voices)))
