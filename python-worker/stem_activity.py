"""Detects "empty" stems — ones Demucs produced but that hold no real part.

htdemucs_6s always writes 6 stems, so a song without piano still gets a
piano.mp3 of (near-)silence or faint bleed from other instruments. Those cost
disk space (an MP3 of silence is as big as any other at constant bitrate) and
clutter the mixer.

Conservative on purpose — a short real part (a piano only in the bridge)
must survive. A stem is empty when it is clearly audible (0.5 s windows above
AUDIBLE_DB) for less than MIN_AUDIBLE_SECS in the whole song, or for less than
MAX_BLEED_SECS while even its loud moments (95th percentile) stay below
BLEED_P95_DB — i.e. only stray bleed.
"""

import numpy as np

SR = 11025
WINDOW_SECS = 0.5
AUDIBLE_DB = -40.0
MIN_AUDIBLE_SECS = 2.0
MAX_BLEED_SECS = 8.0
BLEED_P95_DB = -50.0


def activity_from_samples(y: np.ndarray, sr: int = SR) -> dict:
    """Audible seconds and 95th-percentile window level of a mono signal."""
    win = max(1, int(sr * WINDOW_SECS))
    n = len(y) // win
    if n == 0:
        return {'audible_secs': 0.0, 'p95_db': -120.0}
    frames = y[: n * win].reshape(n, win).astype(np.float64)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    db = 20 * np.log10(rms + 1e-10)
    return {
        'audible_secs': float(np.sum(db > AUDIBLE_DB) * WINDOW_SECS),
        'p95_db': float(np.percentile(db, 95)),
    }


def is_empty(activity: dict) -> bool:
    secs, p95 = activity['audible_secs'], activity['p95_db']
    return secs < MIN_AUDIBLE_SECS or (secs < MAX_BLEED_SECS and p95 < BLEED_P95_DB)


def stem_activity(path: str) -> dict:
    import librosa

    y, sr = librosa.load(path, sr=SR, mono=True)
    return activity_from_samples(y, sr)


def find_empty_stems(paths: list[str]) -> list[str]:
    """Paths whose stem is empty — never all of them (at least one is kept)."""
    empty = [p for p in paths if is_empty(stem_activity(p))]
    return empty if len(empty) < len(paths) else []
