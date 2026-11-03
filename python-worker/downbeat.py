"""Downbeat ("which beat is the 1") estimation from separated stems.

Given the beat grid already found on the drums stem, scores each of the 4
possible bar phases using cues that line up with the start of a bar:

  * bass onsets      — bassists overwhelmingly attack on the 1
  * kick drum        — low-band onsets of the drums stem (lands on 1 and 3)
  * harmonic change  — chord/root changes, measured as chroma novelty of the
                       bass stem between consecutive beats

Each cue is z-scored over beats so none dominates by scale; the phase whose
beats have the highest combined score wins. The kick alone can't tell 1 from
3; bass onsets and harmonic change break that tie.

Returns the phase as `shift` in the renderer's convention: beat-grid index i
is a downbeat when (i - shift) % 4 == 0 (see src/renderer/src/hooks/downbeat.ts).
"""

import os

import numpy as np

BEATS_PER_BAR = 4
SR = 22050
HOP = 512


def _zscore(x: np.ndarray) -> np.ndarray:
    sd = float(np.std(x))
    return (x - float(np.mean(x))) / sd if sd > 1e-9 else np.zeros_like(x)


def _sample_at_beats(envelope: np.ndarray, beat_frames: np.ndarray, radius: int = 2) -> np.ndarray:
    """Peak of an onset envelope in a small window around each beat (beat
    tracking can be a frame or two off the true onset)."""
    out = np.zeros(len(beat_frames))
    n = len(envelope)
    for i, f in enumerate(beat_frames):
        lo, hi = max(0, f - radius), min(n, f + radius + 1)
        out[i] = envelope[lo:hi].max() if hi > lo else 0.0
    return out


def phase_scores(features: list[np.ndarray], beats_per_bar: int = BEATS_PER_BAR) -> np.ndarray:
    """Combined z-scored cue strength per bar phase (index = shift)."""
    n = min(len(f) for f in features)
    combined = np.zeros(n)
    for f in features:
        combined += _zscore(np.asarray(f[:n], dtype=float))
    scores = np.full(beats_per_bar, -np.inf)
    for k in range(beats_per_bar):
        sel = combined[k::beats_per_bar]
        if len(sel):
            scores[k] = float(np.mean(sel))
    return scores


def pick_phase(scores: np.ndarray) -> tuple[int, float]:
    """Best phase and a 0..1 confidence (margin over the runner-up)."""
    order = np.argsort(scores)[::-1]
    best, second = scores[order[0]], scores[order[1]]
    spread = float(np.max(scores) - np.min(scores))
    confidence = float((best - second) / spread) if spread > 1e-9 else 0.0
    return int(order[0]), round(confidence, 3)


def _find_stem(stem_dir: str, name: str) -> str | None:
    for ext in ('.mp3', '.wav', '.flac'):
        path = os.path.join(stem_dir, name + ext)
        if os.path.exists(path):
            return path
    return None


def estimate_downbeat_shift(
    beat_times: list[float], stem_dir: str, drums_y: np.ndarray | None = None
) -> dict | None:
    """Returns {"shift": 0-3, "confidence": 0-1}, or None if there isn't
    enough to go on (no stems, too few beats)."""
    import librosa

    if len(beat_times) < BEATS_PER_BAR * 4:
        return None
    beat_frames = librosa.time_to_frames(np.asarray(beat_times), sr=SR, hop_length=HOP)
    features: list[np.ndarray] = []

    bass_path = _find_stem(stem_dir, 'bass')
    if bass_path:
        yb, _ = librosa.load(bass_path, sr=SR, mono=True)
        bass_onsets = librosa.onset.onset_strength(y=yb, sr=SR, hop_length=HOP)
        features.append(_sample_at_beats(bass_onsets, beat_frames))

        chroma = librosa.feature.chroma_stft(y=yb, sr=SR, hop_length=HOP)
        # Column j+1 is the segment starting at beat j; novelty at beat j is how
        # different it is from the segment before it.
        synced = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
        norm = synced / (np.linalg.norm(synced, axis=0, keepdims=True) + 1e-9)
        cos = np.sum(norm[:, 1:] * norm[:, :-1], axis=0)
        features.append(1.0 - cos[: len(beat_frames)])

    if drums_y is None:
        drums_path = _find_stem(stem_dir, 'drums')
        if drums_path:
            drums_y, _ = librosa.load(drums_path, sr=SR, mono=True)
    if drums_y is not None:
        low = librosa.feature.melspectrogram(
            y=drums_y, sr=SR, hop_length=HOP, n_mels=16, fmax=200
        )
        kick = librosa.onset.onset_strength(S=librosa.power_to_db(low), sr=SR, hop_length=HOP)
        features.append(_sample_at_beats(kick, beat_frames))

    if not features:
        return None
    shift, confidence = pick_phase(phase_scores(features))
    return {'shift': shift, 'confidence': confidence}
