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

HAS_TEMPOCNN = False
try:
    from tempocnn.classifier import TempoClassifier  # noqa: F401
    HAS_TEMPOCNN = True
except ImportError:
    pass

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


@pytest.mark.skipif(not HAS_TEMPOCNN, reason='tempocnn not installed')
class TestDetectBpm:
    def test_returns_bpm_and_offset(self):
        sr = 44100
        duration = 10
        t = np.arange(sr * duration) / sr
        bpm = 120
        signal = (np.sin(2 * np.pi * (bpm / 60) * t) * 0.5).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'drums.wav')
            _write_wav(path, signal, sr)
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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
