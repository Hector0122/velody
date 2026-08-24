#!/usr/bin/env python3
"""BPM detection via TempoCNN + beat alignment via librosa.

Usage:
    python detect_bpm.py <audio_file> [--ffmpeg-path <path>]

Output:
    {"bpm": 128.5, "firstBeatOffset": 0.12, "beatTimes": [0.12, 0.59, ...]}
    or {"error": "..."}
"""

import sys
import json
import os


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
        return _beat_track_result(tempo_librosa, beat_frames, sr)

    from tempocnn.classifier import TempoClassifier
    from tempocnn.feature import read_features

    classifier = TempoClassifier('cnn')
    features = read_features(audio_file, frames=256, hop_length=32)
    tempo = classifier.estimate_tempo(features, interpolate=True)

    try:
        import librosa
        y, sr = librosa.load(audio_file, sr=22050, mono=True)
        tempo_librosa, beat_frames = librosa.beat.beat_track(y=y, sr=sr, bpm=tempo)
        return _beat_track_result(tempo_librosa, beat_frames, sr)
    except ImportError:
        return {'bpm': round(tempo, 1), 'firstBeatOffset': 0.0, 'beatTimes': []}


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
