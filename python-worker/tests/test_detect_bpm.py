import sys
import os
import struct
import subprocess
import tempfile
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DETECT_BPM_SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'detect_bpm.py'
)

HAS_LIBROSA = False
try:
    import librosa  # noqa: F401
    HAS_LIBROSA = True
except ImportError:
    pass


def _write_wav(path: str, signal: np.ndarray, sr: int = 44100):
    num_samples = len(signal)
    data = (signal * 32767).astype(np.int16).tobytes()
    with open(path, 'wb') as f:
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + len(data)))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))
        f.write(struct.pack('<H', 1))
        f.write(struct.pack('<H', 1))
        f.write(struct.pack('<I', sr))
        f.write(struct.pack('<I', sr * 2))
        f.write(struct.pack('<H', 2))
        f.write(struct.pack('<H', 16))
        f.write(b'data')
        f.write(struct.pack('<I', len(data)))
        f.write(data)


def _click_track_wav(path: str, bpm: float, duration: int = 10, sr: int = 44100):
    interval = 60.0 / bpm
    signal = np.zeros(sr * duration, dtype=np.float32)
    t = 0.0
    while t < duration:
        idx = int(t * sr)
        click_len = int(0.02 * sr)
        end = min(idx + click_len, len(signal))
        n = end - idx
        envelope = np.exp(-np.linspace(0, 20, n)).astype(np.float32)
        signal[idx:end] += envelope * 0.8
        t += interval
    _write_wav(path, signal, sr)


class TestScriptInterface:
    def test_no_args_returns_error(self):
        result = subprocess.run(
            [sys.executable, DETECT_BPM_SCRIPT],
            capture_output=True,
            text=True
        )
        assert result.returncode == 1
        import json
        data = json.loads(result.stdout.strip())
        assert 'error' in data

    def test_nonexistent_file_returns_error(self):
        result = subprocess.run(
            [sys.executable, DETECT_BPM_SCRIPT, '/nonexistent/file.wav'],
            capture_output=True,
            text=True
        )
        assert result.returncode == 1
        import json
        data = json.loads(result.stdout.strip())
        assert 'error' in data

    def test_empty_wav_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'empty.wav')
            with open(path, 'wb') as f:
                f.write(b'RIFF\x24\x00\x00\x00WAVE')
            result = subprocess.run(
                [sys.executable, DETECT_BPM_SCRIPT, path],
                capture_output=True,
                text=True
            )
            assert result.returncode == 1
            import json
            data = json.loads(result.stdout.strip())
            assert 'error' in data


@pytest.mark.skipif(not HAS_LIBROSA, reason='librosa not installed')
class TestDetectBpm:
    def test_returns_bpm_and_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'drums.wav')
            _click_track_wav(path, 120)
            result = subprocess.run(
                [sys.executable, DETECT_BPM_SCRIPT, path],
                capture_output=True,
                text=True
            )
        assert result.returncode == 0
        import json
        data = json.loads(result.stdout.strip())
        assert 'bpm' in data
        assert 'firstBeatOffset' in data
        assert 'beatTimes' in data
        assert isinstance(data['bpm'], (int, float))
        assert isinstance(data['firstBeatOffset'], (int, float))
        assert isinstance(data['beatTimes'], list)
        assert 40 <= data['bpm'] <= 300
        assert data['firstBeatOffset'] >= 0
        if data['beatTimes']:
            assert all(isinstance(t, (int, float)) for t in data['beatTimes'])
            assert data['beatTimes'] == sorted(data['beatTimes'])
            assert data['beatTimes'][0] == data['firstBeatOffset']

    @pytest.mark.skipif(not HAS_LIBROSA, reason='librosa not installed')
    def test_first_beat_offset_is_non_negative(self):
        sr = 44100
        t = np.arange(sr * 5) / sr
        signal = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'vocals.wav')
            _write_wav(path, signal, sr)
            result = subprocess.run(
                [sys.executable, DETECT_BPM_SCRIPT, path],
                capture_output=True,
                text=True
            )
        import json
        data = json.loads(result.stdout.strip())
        assert data['firstBeatOffset'] >= 0


@pytest.mark.skipif(not HAS_LIBROSA, reason='librosa not installed')
class TestBpmHint:
    # --bpm-hint (used by add-tempo-octave-correction to re-run detection at
    # a user-corrected tempo) is librosa only.
    def test_bpm_hint_finds_beats_at_the_given_tempo(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'click151.wav')
            _click_track_wav(path, bpm=151.0)
            result = subprocess.run(
                [sys.executable, DETECT_BPM_SCRIPT, path, '--bpm-hint', '151'],
                capture_output=True,
                text=True
            )
        assert result.returncode == 0
        import json
        data = json.loads(result.stdout.strip())
        assert 'bpm' in data
        assert 'beatTimes' in data
        # Should find (roughly) every click, not every other one — the
        # hint's tempo, not half or double of it.
        assert 130 <= data['bpm'] <= 170
        assert len(data['beatTimes']) > 15  # ~10s at ~151bpm ≈ 25 beats

    def test_wrong_bpm_hint_still_returns_a_valid_grid(self):
        # A hint that's itself off by an octave (half the real tempo) still
        # produces a usable result (beat_track locks to roughly that
        # tempo) — confirms the mechanism is just "detect at this tempo",
        # not something that silently fails on a bad hint.
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'click151.wav')
            _click_track_wav(path, bpm=151.0)
            result = subprocess.run(
                [sys.executable, DETECT_BPM_SCRIPT, path, '--bpm-hint', '75.5'],
                capture_output=True,
                text=True
            )
        assert result.returncode == 0
        import json
        data = json.loads(result.stdout.strip())
        assert 60 <= data['bpm'] <= 90
        assert len(data['beatTimes']) > 5


def test_drop_doubled_beats_removes_an_extra_beat_between_two_real_ones():
    from detect_bpm import drop_doubled_beats
    # Zombie's intro as Beat This returns it: an extra beat at 6.5 s.
    beats = [4.44, 5.28, 6.08, 6.5, 6.9, 7.72, 8.52, 9.32, 10.14]
    assert drop_doubled_beats(beats) == [4.44, 5.28, 6.08, 6.9, 7.72, 8.52, 9.32, 10.14]
    assert drop_doubled_beats([0.0, 0.5, 1.0, 1.5]) == [0.0, 0.5, 1.0, 1.5]


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
