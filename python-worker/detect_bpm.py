#!/usr/bin/env python3
"""BPM detection via TempoCNN + beat alignment via librosa.

Usage:
    python detect_bpm.py <audio_file> [--ffmpeg-path <path>]

Output:
    {"bpm": 128.5, "firstBeatOffset": 0.12}  or  {"error": "..."}
"""

import sys
import json
import os


def detect_bpm(audio_file: str, ffmpeg_path: str = 'ffmpeg') -> dict:
    os.environ['FFMPEG_PATH'] = ffmpeg_path

    from tempocnn.classifier import TempoClassifier
    from tempocnn.feature import read_features

    classifier = TempoClassifier('cnn')
    features = read_features(audio_file, frames=256, hop_length=32)
    tempo = classifier.estimate_tempo(features, interpolate=True)

    try:
        import librosa
        y, sr = librosa.load(audio_file, sr=22050, mono=True)
        tempo_librosa, beat_frames = librosa.beat.beat_track(y=y, sr=sr, bpm=tempo)
        if hasattr(tempo_librosa, '__float__'):
            tempo_librosa = float(tempo_librosa)
        if len(beat_frames) > 0:
            first_beat_sample = librosa.frames_to_time(beat_frames[0], sr=sr)
        else:
            first_beat_sample = 0.0
        return {'bpm': round(tempo_librosa, 1), 'firstBeatOffset': round(first_beat_sample, 4)}
    except ImportError:
        return {'bpm': round(tempo, 1), 'firstBeatOffset': 0.0}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: detect_bpm.py <audio_file> [--ffmpeg-path <path>]"}))
        sys.exit(1)

    try:
        args = list(sys.argv[1:])
        audio_file = args[0]
        ffmpeg_path = 'ffmpeg'

        if '--ffmpeg-path' in args:
            idx = args.index('--ffmpeg-path')
            if idx + 1 < len(args):
                ffmpeg_path = args[idx + 1]

        result = detect_bpm(audio_file, ffmpeg_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
