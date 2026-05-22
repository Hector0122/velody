#!/usr/bin/env python3
"""Velody Song Analyzer.

Pre-computes bass tablature and chord timeline from separated stems.

Usage:
    python analyze.py <output-dir>

Expects <output-dir> to contain bass.mp3, other.mp3, etc.
Outputs <output-dir>/analysis.json
"""

import sys
import json
import warnings
from pathlib import Path

import numpy as np
import librosa

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
STRING_MIDI = [43, 38, 33, 28]
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def midi_to_tab(midi: int):
    if midi < 28 or midi > 67:
        return None
    best_s, best_f = -1, 99
    for s, base in enumerate(STRING_MIDI):
        f = midi - base
        if 0 <= f <= 24 and f < best_f:
            best_f, best_s = f, s
    if best_s < 0:
        return None
    return {'string': best_s, 'fret': best_f}


def detect_key(agg_chroma):
    best_root, best_score, best_mode = 0, -np.inf, 'major'
    for root in range(12):
        rotated = np.roll(agg_chroma, -root)
        s_maj = np.dot(rotated, KK_MAJOR)
        s_min = np.dot(rotated, KK_MINOR)
        if s_maj > best_score:
            best_score, best_root, best_mode = s_maj, root, 'major'
        if s_min > best_score:
            best_score, best_root, best_mode = s_min, root, 'minor'
    return best_root, best_mode


def analyze_bass(path: Path, sr: int) -> list:
    # 90 s is enough for most songs; harmonic separation cleans up the signal
    y, sr = librosa.load(str(path), sr=sr, duration=90)
    try:
        y = librosa.effects.harmonic(y, margin=4)
    except Exception:
        pass  # fall back to raw signal if HPSS fails (short audio or version issue)
    hop_length = 1024
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=28, fmax=400, sr=sr, hop_length=hop_length,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)
    notes = []
    prev_midi = None
    last_note_time = -1.0
    MIN_PROB = 0.55
    MIN_NOTE_GAP = 0.08
    for t, f, v, prob in zip(times, f0, voiced_flag, voiced_prob):
        if v and not np.isnan(f) and prob > MIN_PROB:
            midi = int(round(12 * np.log2(f / 440) + 69))
            if midi != prev_midi and (t - last_note_time) >= MIN_NOTE_GAP:
                tab = midi_to_tab(midi)
                if tab:
                    notes.append({'time': round(t, 2), 'midi': midi, **tab})
                    prev_midi = midi
                    last_note_time = t
        elif not v:
            prev_midi = None  # reset on silence gap
    return notes


def build_mix(stems_dir: Path, target_sr: int, stem_names: tuple) -> np.ndarray:
    max_len = 0
    buffers = []
    for stem_name in stem_names:
        for ext in ('.mp3', '.wav', '.flac'):
            p = stems_dir / f'{stem_name}{ext}'
            if p.exists():
                y, _ = librosa.load(str(p), sr=target_sr, duration=120)
                buffers.append(y)
                if len(y) > max_len:
                    max_len = len(y)
                break
    if not buffers:
        raise FileNotFoundError(f'No stems found in {stem_names}')
    mix = np.zeros(max_len)
    for y in buffers:
        mix[:len(y)] += y
    peak = np.max(np.abs(mix))
    if peak > 0:
        mix /= peak
    return mix


def build_harmonic_mix(stems_dir: Path, target_sr: int) -> np.ndarray:
    # Exclude bass (root-note bias) and drums (no harmonic content)
    return build_mix(stems_dir, target_sr, ('guitar', 'piano', 'other', 'vocals'))




def analyze_chords(stems_dir: Path, key_override: tuple | None = None) -> dict:
    import essentia.standard as es

    SR_ES = 44100
    hop_size = 2048
    frame_size = 4096

    # Build harmonic mix at essentia's native sample rate (guitar/piano/other/vocals, no bass/drums)
    y_upper = build_harmonic_mix(stems_dir, SR_ES).astype(np.float32)

    # HPCP computation pipeline
    windowing   = es.Windowing(type='blackmanharris62')
    spectrum_fn = es.Spectrum()
    peaks_fn    = es.SpectralPeaks(
        orderBy='magnitude', magnitudeThreshold=1e-5,
        minFrequency=40.0, maxFrequency=5000.0, maxPeaks=10000,
    )
    hpcp_fn = es.HPCP()

    hpcps = []
    for frame in es.FrameGenerator(y_upper, frameSize=frame_size, hopSize=hop_size, startFromZero=True):
        win  = windowing(frame)
        spec = spectrum_fn(win)
        freqs, mags = peaks_fn(spec)
        hpcps.append(hpcp_fn(freqs, mags))

    if not hpcps:
        return {'key_root': 0, 'key_mode': 'major', 'key_name': 'C', 'chords': []}

    # Key detection on aggregate HPCP (used only if no override provided)
    if key_override:
        key_root, key_mode = key_override
    else:
        key_root, key_mode = detect_key(np.mean(hpcps, axis=0))

    # HMM-based chord detection with 2-second smoothing window
    chords_arr, _ = es.ChordsDetection(
        hopSize=hop_size, sampleRate=float(SR_ES), windowSize=2.0
    )(hpcps)

    # Build chord timeline by collapsing consecutive identical chords
    frame_dur = hop_size / SR_ES  # ~0.046 s per frame
    min_dur = 0.8
    segments: list[dict] = []
    prev_chord = ''
    seg_start = 0.0

    for i, chord in enumerate(chords_arr):
        t = i * frame_dur
        if chord != prev_chord:
            if prev_chord and t - seg_start >= min_dur:
                segments.append({'start': round(seg_start, 1), 'end': round(t, 1), 'chord': prev_chord})
            seg_start = t
            prev_chord = chord

    end_t = len(chords_arr) * frame_dur
    if prev_chord and end_t - seg_start >= min_dur:
        segments.append({'start': round(seg_start, 1), 'end': round(end_t, 1), 'chord': prev_chord})

    # Fill gaps shorter than 2s by extending the previous segment
    filled: list[dict] = []
    for seg in segments:
        if filled and seg['start'] - filled[-1]['end'] < 2.0:
            filled[-1] = dict(filled[-1], end=seg['start'])
        filled.append(dict(seg))

    # Merge adjacent segments with the same chord (result of gap-fill)
    segments = []
    for seg in filled:
        if segments and segments[-1]['chord'] == seg['chord']:
            segments[-1] = dict(segments[-1], end=seg['end'])
        else:
            segments.append(dict(seg))

    key_name = NOTE_NAMES[key_root] + ('m' if key_mode == 'minor' else '')
    return {'key_root': key_root, 'key_mode': key_mode, 'key_name': key_name, 'chords': segments}


def analyze(output_dir: str) -> dict:
    out_path = Path(output_dir)
    sr = 16000

    bass_path = None
    for ext in ('.mp3', '.wav', '.flac'):
        p = out_path / f'bass{ext}'
        if p.exists():
            bass_path = p
            break

    if bass_path:
        print(f'  Analyzing bass: {bass_path.name}', file=sys.stderr)
        bass_tab = analyze_bass(bass_path, sr)
    else:
        print('  No bass stem found', file=sys.stderr)
        bass_tab = []

    print('  Building mixes...', file=sys.stderr)
    try:
        # Full mix WITH bass for key detection — root notes help identify tonal centre
        key_mix = build_mix(out_path, sr, ('bass', 'guitar', 'piano', 'other', 'vocals'))
        key_chroma = librosa.feature.chroma_stft(y=key_mix, sr=sr, hop_length=512, n_fft=4096)
        agg = np.mean(key_chroma, axis=1)
        key_root, key_mode = detect_key(agg)
        print(f'  Detected key: {NOTE_NAMES[key_root]}{"m" if key_mode == "minor" else ""}', file=sys.stderr)
        print('  Analyzing chords...', file=sys.stderr)
        chord_data = analyze_chords(out_path, key_override=(key_root, key_mode))
    except (FileNotFoundError, Exception) as e:
        print(f'  Analysis failed: {e}', file=sys.stderr)
        chord_data = {'key_root': 0, 'key_mode': 'major', 'key_name': 'C', 'chords': []}

    result = {
        'key_root': chord_data['key_root'],
        'key_mode': chord_data['key_mode'],
        'key_name': chord_data['key_name'],
        'bass_tab': bass_tab,
        'chords': chord_data['chords'],
    }

    json_path = out_path / 'analysis.json'
    with open(json_path, 'w') as f:
        json.dump(result, f)
    print(f'  Saved analysis to {json_path}', file=sys.stderr)
    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No output directory provided'}), file=sys.stderr)
        sys.exit(1)
    try:
        result = analyze(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
