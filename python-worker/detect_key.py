#!/usr/bin/env python3
"""Key detection via numpy FFT + Krumhansl-Schmuckler.

Usage:
    python detect_key.py <song_dir> <stem_path1> [stem_path2 ...]

Output:
    {"key": "E Minor"}  or  {"error": "..."}
"""

import sys, json, os, math
import numpy as np

KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def decode_audio(path: str, sr: int = 44100) -> np.ndarray:
    import subprocess as sp
    cmd = ['ffmpeg', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-']
    proc = sp.run(cmd, capture_output=True, check=True)
    return np.frombuffer(proc.stdout, dtype=np.float32)


def compute_chroma(signal: np.ndarray, sr: int, start_offset: float = 5.0) -> np.ndarray:
    fft_size = 32768
    hop = fft_size // 4
    start = int(start_offset * sr)
    if start >= len(signal):
        return np.zeros(12)
    data = signal[start:]
    frames = (len(data) - fft_size) // hop
    if frames < 1:
        return np.zeros(12)
    window = np.hanning(fft_size)
    chroma = np.zeros(12)
    processed = 0
    step = max(1, frames // 60)
    for f in range(0, frames, step):
        segment = data[f * hop:f * hop + fft_size] * window
        spectrum = np.fft.rfft(segment)
        mag = np.abs(spectrum)
        freqs = np.fft.rfftfreq(fft_size, 1.0 / sr)
        mask = (freqs >= 40) & (freqs <= 2000)
        fm = freqs[mask]
        mm = mag[mask]
        if len(fm) == 0:
            continue
        mn = 12.0 * np.log2(fm / 440.0) + 69.0
        semitone = mn % 12.0
        lo = np.floor(semitone).astype(np.intp) % 12
        hi = (lo + 1) % 12
        blend = semitone - np.floor(semitone)
        np.add.at(chroma, lo, mm * (1.0 - blend))
        np.add.at(chroma, hi, mm * blend)
        processed += 1
    if processed > 0:
        chroma /= processed
    mx = chroma.max()
    if mx > 0:
        chroma /= mx
    return chroma


def detect_key(stem_paths: list[str]) -> str:
    sr = 44100
    # Find bass stem
    bass_path = next((p for p in stem_paths if os.path.splitext(os.path.basename(p))[0].lower() == 'bass'), None)
    if bass_path:
        bass_sig = decode_audio(bass_path, sr)
        peak = np.max(np.abs(bass_sig))
        if peak > 0 and peak < 1e-6:
            bass_path = None
    if bass_path:
        chroma = compute_chroma(bass_sig, sr, 5.0)
    else:
        harmonic = [p for p in stem_paths if os.path.splitext(os.path.basename(p))[0].lower() not in ('drums', 'vocals')]
        if not harmonic:
            return 'C Major'
        sig = None
        for p in harmonic:
            s = decode_audio(p, sr)
            if sig is None:
                sig = np.zeros_like(s)
            elif len(s) > len(sig):
                sig = np.pad(sig, (0, len(s) - len(sig)))
            sig[:len(s)] += s
        if sig is None:
            return 'C Major'
        peak = np.max(np.abs(sig))
        if peak > 0:
            sig /= peak
        chroma = compute_chroma(sig, sr, 5.0)

    # Krumhansl-Schmuckler on bass chroma
    # Score all 24 keys
    scores: list[tuple[float, str]] = []
    for tonic in range(12):
        shifted = np.roll(chroma, -tonic)
        for profile, mode in [(KS_MAJOR, ' Major'), (KS_MINOR, ' Minor')]:
            s = np.dot(profile, shifted)
            scores.append((s, NOTE_NAMES[tonic] + mode))
    scores.sort(key=lambda x: -x[0])

    best_key = scores[0][1]
    best_tonic = int(NOTE_NAMES.index(best_key.split()[0]))

    # Check if bass has a dominant strongest note (margin > 10% over 2nd)
    sorted_idx = np.argsort(-chroma)
    strongest = int(sorted_idx[0])
    strongest_val = chroma[strongest]
    second_val = chroma[int(sorted_idx[1])]
    dominant_margin = (strongest_val - second_val) / max(strongest_val, 1e-10)

    # If KS is uncertain (gap < 5%) and bass has a clear dominant note, override
    gap = (scores[0][0] - scores[1][0]) / max(abs(scores[0][0]), 1e-10)
    if gap < 0.05 and dominant_margin > 0.1 and best_tonic != strongest:
        s_maj = np.dot(KS_MAJOR, np.roll(chroma, -strongest))
        s_min = np.dot(KS_MINOR, np.roll(chroma, -strongest))
        best_key = NOTE_NAMES[strongest] + (' Major' if s_maj > s_min else ' Minor')

    return best_key


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: detect_key.py <song_dir> <stem_path> ..."}))
        sys.exit(1)
    try:
        key = detect_key(sys.argv[2:])
        print(json.dumps({"key": key}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
