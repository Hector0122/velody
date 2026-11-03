"""Tests for downbeat (bar phase) estimation — python-worker/downbeat.py."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from downbeat import phase_scores, pick_phase  # noqa: E402

HAS_LIBROSA = True
try:
    import librosa  # noqa: F401
    import soundfile  # noqa: F401
except ImportError:
    HAS_LIBROSA = False


class TestPhaseScoring:
    def test_strongest_phase_wins(self):
        # Accents every 4th beat starting at index 2.
        cue = np.array([0.1, 0.1, 1.0, 0.1] * 16)
        shift, confidence = pick_phase(phase_scores([cue]))
        assert shift == 2
        assert confidence > 0.5

    def test_bass_breaks_a_kick_tie_between_1_and_3(self):
        kick = np.array([1.0, 0.1, 1.0, 0.1] * 16)  # kick on 1 and 3 (phases 0, 2)
        bass = np.array([0.1, 0.1, 1.0, 0.1] * 16)  # bass attacks only on phase 2
        shift, _ = pick_phase(phase_scores([kick, bass]))
        assert shift == 2

    def test_flat_cues_give_zero_confidence(self):
        _, confidence = pick_phase(phase_scores([np.ones(64)]))
        assert confidence == 0.0


@pytest.mark.skipif(not HAS_LIBROSA, reason='librosa/soundfile not installed')
class TestEstimateFromStems:
    def test_finds_the_bar_start_in_synthetic_stems(self, tmp_path):
        import soundfile as sf
        from downbeat import SR, estimate_downbeat_shift

        bpm, bars, first_bar_beat = 120, 16, 1  # bar starts on grid index 1
        interval = 60 / bpm
        n_beats = bars * 4 + first_bar_beat
        beat_times = [0.5 + i * interval for i in range(n_beats)]
        length = int((beat_times[-1] + 1.0) * SR)
        drums = np.zeros(length)
        bass = np.zeros(length)
        t = np.arange(int(0.15 * SR)) / SR
        kick = np.sin(2 * np.pi * 60 * t) * np.exp(-t * 30)
        roots = [55.0, 73.4, 82.4, 61.7]  # root changes every bar
        for i, bt in enumerate(beat_times):
            s = int(bt * SR)
            bar_pos = (i - first_bar_beat) % 4
            if bar_pos in (0, 2):  # kick on 1 and 3
                drums[s : s + len(kick)] += kick
            if bar_pos == 0:  # bass attacks a new root on the 1
                root = roots[((i - first_bar_beat) // 4) % len(roots)]
                note = np.arange(int(interval * 4 * SR)) / SR
                tone = 0.6 * np.sin(2 * np.pi * root * note) * np.exp(-note * 1.5)
                end = min(length, s + len(tone))
                bass[s:end] += tone[: end - s]
        sf.write(tmp_path / 'drums.wav', drums, SR)
        sf.write(tmp_path / 'bass.wav', bass, SR)

        est = estimate_downbeat_shift(beat_times, str(tmp_path))
        assert est is not None
        assert est['shift'] == first_bar_beat
