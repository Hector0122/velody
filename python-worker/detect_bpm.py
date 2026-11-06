#!/usr/bin/env python3
"""Beat grid via the Beat This! neural tracker on the song's stem mix; falls
back to librosa's beat tracker (drums stem) when it's unavailable.

Usage:
    python detect_bpm.py <audio_file> [--ffmpeg-path <path>]

Output:
    {"bpm": 128.5, "firstBeatOffset": 0.12, "beatTimes": [0.12, 0.59, ...],
     "downbeatShift": 2, "downbeatConfidence": 0.4,   # downbeat* only when stems are found
     "chords": [{"time": 0.12, "chord": "Em"}, ...]}  # chords only when detection worked
    or {"error": "..."}
"""

import contextlib
import sys
import json
import os

import numpy as np

# Separated stems only — user recordings live in the same folder.
STEM_NAMES = ('drums', 'bass', 'other', 'guitar', 'piano', 'vocals')


def _with_downbeat(result: dict, audio_file: str, y) -> dict:
    """Adds `downbeatShift`/`downbeatConfidence` (which beat is the bar's 1)
    using the sibling bass/drums stems. Best-effort: any failure just leaves
    them out and the app falls back to the manual "This is the 1" button."""
    try:
        from downbeat import estimate_downbeat_shift
        # Reuse the already-loaded audio as the drums signal only if that's
        # what it is (the app analyzes drums when the song has that stem).
        is_drums = os.path.basename(audio_file).lower().startswith('drums')
        est = estimate_downbeat_shift(
            result.get('beatTimes', []),
            os.path.dirname(os.path.abspath(audio_file)),
            y if is_drums else None,
        )
        if est:
            result['downbeatShift'] = est['shift']
            result['downbeatConfidence'] = est['confidence']
    except Exception:
        pass
    return result


def _song_mix(audio_file: str, sr: int = 22050):
    """The song's stems summed back into a mix: an intro without drums only has
    a pulse in the other instruments (Zombie's guitar intro). Falls back to the
    given file alone when it isn't in a song folder."""
    import librosa
    d = os.path.dirname(os.path.abspath(audio_file))
    mix = None
    for f in sorted(os.listdir(d)):
        name, ext = os.path.splitext(f)
        if name.lower() not in STEM_NAMES or ext.lower() not in ('.mp3', '.wav', '.flac'):
            continue
        y, _ = librosa.load(os.path.join(d, f), sr=sr, mono=True)
        mix = y if mix is None else mix[:len(y)] + y[:len(mix)]
    if mix is None:
        mix, _ = librosa.load(audio_file, sr=sr, mono=True)
    return mix


def drop_doubled_beats(beats: list) -> list:
    """Beat This now and then fires an extra beat between two real ones
    (Zombie at 6.5 s: gaps 0.80, 0.42, 0.40, 0.82) — a double click. Drops any
    beat closer than 0.65x the median gap to the previous kept beat."""
    if len(beats) < 3:
        return beats
    min_gap = 0.65 * float(np.median(np.diff(beats)))
    kept = [beats[0]]
    for b in beats[1:]:
        if b - kept[-1] >= min_gap:
            kept.append(b)
    return kept


def _with_chords(result: dict, audio_file: str, mix=None) -> dict:
    """Adds `chords` ([{time, chord}] at each change, see chords.py) on the
    result's beat grid. Best-effort like the downbeat: on any failure (model
    not downloadable offline, …) they're just left out."""
    if len(result.get('beatTimes', [])) < 2:
        return result
    try:
        from chords import detect_chords
        y = mix if mix is not None else _song_mix(audio_file)
        result['chords'] = detect_chords(y, result['beatTimes'])
    except Exception as e:
        print(f'[detect_bpm] chord detection failed: {e}', file=sys.stderr)
    return result


def _beat_this_grid(mix, sr: int = 22050):
    """Follows tempo changes the drums stem can't show (a slower intro before
    the drums enter). Raises ImportError when beat_this isn't installed."""
    from beat_this.inference import Audio2Beats
    # The checkpoint (77 MB) is downloaded once to the torch hub cache.
    with contextlib.redirect_stdout(sys.stderr):
        beats, _ = Audio2Beats(checkpoint_path='final0', device='cpu', dbn=False)(mix, sr)
    beats = drop_doubled_beats([float(b) for b in beats])
    if len(beats) < 2:
        return None
    return {
        'bpm': round(60.0 / float(np.median(np.diff(beats))), 1),
        'firstBeatOffset': round(beats[0], 4),
        'beatTimes': [round(b, 4) for b in beats],
        'tracker': 'beat_this',
    }


def _no_grid(tempo: float) -> dict:
    return {'bpm': round(float(tempo), 1), 'firstBeatOffset': 0.0, 'beatTimes': []}


def _beat_track_result(tempo_librosa, beat_frames, sr) -> dict:
    if hasattr(tempo_librosa, '__float__'):
        tempo_librosa = float(tempo_librosa)
    import librosa
    # beat_track already detects every beat across the whole track, not
    # just the first — keep them all so the metronome can track the song's
    # actual tempo over time instead of extrapolating from a single BPM.
    if len(beat_frames) > 0:
        beat_times = [round(float(t), 4) for t in librosa.frames_to_time(beat_frames, sr=sr)]
    else:
        beat_times = []
    first_beat_sample = beat_times[0] if beat_times else 0.0
    return {
        'bpm': round(tempo_librosa, 1),
        'firstBeatOffset': first_beat_sample,
        'beatTimes': beat_times
    }


def detect_bpm(audio_file: str, ffmpeg_path: str = 'ffmpeg', bpm_hint: float = None) -> dict:
    os.environ['FFMPEG_PATH'] = ffmpeg_path

    if bpm_hint is not None:
        # Tempo-octave correction (see add-tempo-octave-correction): the
        # caller already knows the real tempo is ~2x or ~0.5x what was
        # originally detected (confirmed by ear), so skip TempoCNN's own
        # estimate entirely and re-run librosa's beat tracker with the
        # known-correct tempo as an explicit prior. beat_track's dynamic
        # programming search still aligns each individual beat to the
        # audio's real onset-strength envelope (bounded by its `tightness`
        # parameter) rather than assuming perfectly uniform spacing — this
        # re-derives genuinely onset-aligned beat positions at the
        # corrected tempo directly from the audio, which is far more
        # accurate than arithmetically interpolating/decimating the
        # already-detected (wrong-tempo) grid client-side.
        import librosa
        y, sr = librosa.load(audio_file, sr=22050, mono=True)
        tempo_librosa, beat_frames = librosa.beat.beat_track(y=y, sr=sr, bpm=bpm_hint)
        if len(beat_frames) == 0:
            return _no_grid(bpm_hint)
        return _with_downbeat(_beat_track_result(tempo_librosa, beat_frames, sr), audio_file, y)

    mix = None
    try:
        mix = _song_mix(audio_file)
        result = _beat_this_grid(mix)
        if result:
            return _with_chords(_with_downbeat(result, audio_file, None), audio_file, mix)
    except Exception as e:  # not installed, offline first run, decode error…
        print(f'[detect_bpm] Beat This unavailable ({e}); using librosa', file=sys.stderr)

    # Fallback: librosa's own tempo estimate + beat tracker on the drums stem.
    # (TempoCNN used to provide the tempo prior here; it pulled in ~2 GB of
    # TensorFlow for a path only taken when Beat This! can't run. A tempo-
    # octave error here is fixable with the x2 / /2 buttons.)
    import librosa
    y, sr = librosa.load(audio_file, sr=22050, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    # No onsets to track (sustained, beatless audio): no grid, and a 0 BPM,
    # which the app treats as a failed detection (never cached, retried).
    if len(beat_frames) == 0:
        return _no_grid(float(np.atleast_1d(tempo)[0]))
    result = _with_downbeat(_beat_track_result(tempo, beat_frames, sr), audio_file, y)
    return _with_chords(result, audio_file, mix)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Usage: detect_bpm.py <audio_file> [--ffmpeg-path <path>] [--bpm-hint <bpm>]"
        }))
        sys.exit(1)

    try:
        args = list(sys.argv[1:])
        audio_file = args[0]
        ffmpeg_path = 'ffmpeg'
        bpm_hint = None

        if '--ffmpeg-path' in args:
            idx = args.index('--ffmpeg-path')
            if idx + 1 < len(args):
                ffmpeg_path = args[idx + 1]

        if '--bpm-hint' in args:
            idx = args.index('--bpm-hint')
            if idx + 1 < len(args):
                bpm_hint = float(args[idx + 1])

        result = detect_bpm(audio_file, ffmpeg_path, bpm_hint)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
