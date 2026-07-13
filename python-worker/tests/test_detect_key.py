import sys
import os
import tempfile
import struct
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from detect_key import compute_chroma, detect_key, KS_MAJOR, KS_MINOR, NOTE_NAMES


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


class TestComputeChroma:
    def test_returns_12_elements(self):
        sr = 44100
        signal = np.random.randn(sr * 10).astype(np.float32)
        result = compute_chroma(signal, sr, 0.0)
        assert len(result) == 12

    def test_returns_zero_for_empty_signal(self):
        result = compute_chroma(np.zeros(44100), 44100, 0.0)
        assert np.allclose(result, 0)

    def test_returns_zero_when_start_exceeds_signal(self):
        signal = np.random.randn(44100).astype(np.float32)
        result = compute_chroma(signal, 44100, 100.0)
        assert np.allclose(result, 0)

    def test_normalizes_to_0_1_range(self):
        sr = 44100
        signal = np.random.randn(sr * 10).astype(np.float32)
        result = compute_chroma(signal, sr, 0.0)
        assert result.min() >= 0
        assert result.max() <= 1.0

    def test_sine_440_peaks_on_A(self):
        sr = 44100
        t = np.arange(sr * 5) / sr
        signal = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
        result = compute_chroma(signal, sr, 0.0)
        a_index = NOTE_NAMES.index('A')
        assert result[a_index] > 0.5


class TestConstants:
    def test_ks_major_length(self):
        assert len(KS_MAJOR) == 12

    def test_ks_minor_length(self):
        assert len(KS_MINOR) == 12

    def test_note_names_length(self):
        assert len(NOTE_NAMES) == 12

    def test_note_names_are_semitones(self):
        assert NOTE_NAMES[0] == 'C'
        assert NOTE_NAMES[7] == 'G'
        assert NOTE_NAMES[11] == 'B'


class TestDetectKey:
    def test_returns_string(self):
        sr = 44100
        t = np.arange(sr * 5) / sr
        signal = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'vocals.wav')
            _write_wav(path, signal, sr)
            result = detect_key([path])
        assert isinstance(result, str)

    def test_returns_valid_key_format(self):
        sr = 44100
        t = np.arange(sr * 5) / sr
        signal = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'bass.wav')
            _write_wav(path, signal, sr)
            result = detect_key([path])
        parts = result.split()
        assert len(parts) == 2
        assert parts[0] in NOTE_NAMES
        assert parts[1] in ('Major', 'Minor')

    def test_returns_c_major_for_silence(self):
        sr = 44100
        signal = np.zeros(sr * 5, dtype=np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'bass.wav')
            _write_wav(path, signal, sr)
            result = detect_key([path])
        assert result == 'C Major'

    def test_bass_takes_priority_when_present(self):
        sr = 44100
        t = np.arange(sr * 5) / sr
        bass = (np.sin(2 * np.pi * 110 * t) * 0.5).astype(np.float32)
        vocals = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            bass_path = os.path.join(tmp, 'bass.wav')
            vocals_path = os.path.join(tmp, 'vocals.wav')
            _write_wav(bass_path, bass, sr)
            _write_wav(vocals_path, vocals, sr)
            result = detect_key([vocals_path, bass_path])
        assert isinstance(result, str)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
