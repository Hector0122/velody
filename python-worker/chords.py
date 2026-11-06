"""Chord recognition: BTC (Bi-directional Transformer for Chord recognition,
Park et al., ISMIR 2019 — vendored in btc/) on the song's full mix, one chord
per beat of the detected grid.

Major/minor vocabulary (24 chords + N): the 170-chord model was noisier on
real songs (Zombie, Caifanes - Nos vamos juntos), and the full mix beat the
drumless/voiceless stems. The model weights (12 MB, MIT) are downloaded once
from a pinned commit and checked against their SHA-256.
"""

import hashlib
import os
import tempfile
import urllib.request
from collections import Counter

import numpy as np

SR = 22050
INST_LEN = 10.0  # BTC's CQT chunk / model window, in seconds
TIMESTEP = 108  # model frames per window
FRAME_SEC = INST_LEN / TIMESTEP
CHORDS = [r + q for r in ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
          for q in ('', 'm')] + ['N']

MODEL_URL = ('https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/'
             '2682317be668032e6e4b269ded36adaa2ad57df0/test/btc_model.pt')
MODEL_SHA256 = '71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54'
MODEL_PATH = os.path.join(os.path.expanduser('~'), '.local', 'share', 'velody', 'models',
                          'btc_model.pt')

MODEL_CONFIG = dict(feature_size=144, timestep=TIMESTEP, num_chords=len(CHORDS),
                    input_dropout=0.2, layer_dropout=0.2, attention_dropout=0.2,
                    relu_dropout=0.2, num_layers=8, num_heads=4, hidden_size=128,
                    total_key_depth=128, total_value_depth=128, filter_size=128,
                    probs_out=True)

# How strongly the song's own chord vocabulary breaks near-ties (0 = off).
# Power chords have no third, so E vs Em is a coin flip per beat; a song that
# plays Em 170 times and E 18 times means Em. Tuned on two songs: 1.0 took
# Caifanes' false E from 20 beats to 8 and Zombie's F#m (really D/F#) from 13
# to 5 while keeping Caifanes' real F; 1.5 started eating its real D.
SONG_PRIOR_WEIGHT = 1.0


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _model_file() -> str:
    """The checkpoint path, downloading and verifying it on first use."""
    if os.path.exists(MODEL_PATH) and _sha256(MODEL_PATH) == MODEL_SHA256:
        return MODEL_PATH
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(MODEL_PATH), suffix='.part')
    try:
        with os.fdopen(fd, 'wb') as out, urllib.request.urlopen(MODEL_URL, timeout=60) as res:
            while chunk := res.read(1 << 20):
                out.write(chunk)
        if _sha256(tmp) != MODEL_SHA256:
            raise ValueError('chord model download is corrupted (SHA-256 mismatch)')
        os.replace(tmp, MODEL_PATH)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return MODEL_PATH


def frame_probs(y: np.ndarray) -> np.ndarray:
    """Per-frame chord probabilities, shape (frames, 25), FRAME_SEC apart."""
    import librosa
    import torch
    from btc.model import BTC_model

    # weights_only: never run code from the file; only numpy's plain types
    # (the stored feature mean/std) are allowed besides tensors.
    numpy_types = [np.core.multiarray.scalar, np.core.multiarray._reconstruct, np.ndarray,
                   np.dtype, np.dtypes.Float32DType, np.dtypes.Float64DType]
    with torch.serialization.safe_globals(numpy_types):
        ckpt = torch.load(_model_file(), map_location='cpu', weights_only=True)
    model = BTC_model(config=MODEL_CONFIG)
    model.load_state_dict(ckpt['model'])
    model.eval()

    step = int(SR * INST_LEN)
    cqt = np.concatenate(
        [librosa.cqt(y[i:i + step], sr=SR, n_bins=144, bins_per_octave=24, hop_length=2048)
         for i in range(0, len(y), step)], axis=1)
    feat = (np.log(np.abs(cqt) + 1e-6).T - ckpt['mean']) / ckpt['std']
    pad = (-feat.shape[0]) % TIMESTEP
    x = torch.tensor(np.pad(feat, ((0, pad), (0, 0))), dtype=torch.float32).unsqueeze(0)
    out = []
    with torch.no_grad():
        for t in range(x.shape[1] // TIMESTEP):
            hidden, _ = model.self_attn_layers(x[:, t * TIMESTEP:(t + 1) * TIMESTEP, :])
            out.append(torch.softmax(model.output_layer(hidden), -1).squeeze(0).numpy())
    return np.concatenate(out)[:feat.shape[0]]


def beat_chords(probs: np.ndarray, beats: list) -> list:
    """One chord per beat: frame probabilities averaged over each beat, then
    near-ties settled toward the chords the song itself uses most."""
    if len(beats) < 2:
        return []
    ends = beats[1:] + [beats[-1] + (beats[-1] - beats[-2])]
    per_beat = []
    for a, b in zip(beats, ends):
        # +1e-6: a beat exactly on a frame boundary (4.9999… after float math)
        # must not pull in the previous chord's last frame.
        lo = min(int(a / FRAME_SEC + 1e-6), len(probs) - 1)
        hi = max(lo + 1, min(int(b / FRAME_SEC + 1e-6), len(probs)))
        per_beat.append(probs[lo:hi].mean(axis=0))
    per_beat = np.array(per_beat)
    counts = Counter(per_beat.argmax(axis=1))
    prior = np.array([counts.get(i, 0) for i in range(len(CHORDS))], dtype=float) + 1.0
    scored = per_beat * (prior / prior.sum()) ** SONG_PRIOR_WEIGHT
    return [CHORDS[i] for i in scored.argmax(axis=1)]


def chord_changes(beats: list, chords: list) -> list:
    """[{time, chord}] at each change only — what `.velody` stores."""
    out = []
    for t, c in zip(beats, chords):
        if not out or out[-1]['chord'] != c:
            out.append({'time': round(float(t), 3), 'chord': c})
    return out


def detect_chords(y: np.ndarray, beats: list) -> list:
    """Chord changes for a mono 22.05 kHz mix on the given beat grid."""
    return chord_changes(beats, beat_chords(frame_probs(y), beats))
