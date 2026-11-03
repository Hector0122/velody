"""Tests for empty-stem detection — python-worker/stem_activity.py."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import stem_activity as sa  # noqa: E402

SR = sa.SR
SONG_SECS = 240


def tone(secs: float, amp: float) -> np.ndarray:
    t = np.arange(int(secs * SR)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def song_with_part(part_secs: float, amp: float = 0.3, bleed: float = 0.0) -> np.ndarray:
    y = np.zeros(int(SONG_SECS * SR), dtype=np.float32)
    if bleed:
        y += tone(SONG_SECS, bleed)
    if part_secs:
        start = int(min(100, SONG_SECS - part_secs) * SR)
        y[start : start + int(part_secs * SR)] += tone(part_secs, amp)
    return y


class TestIsEmpty:
    def test_silence_is_empty(self):
        assert sa.is_empty(sa.activity_from_samples(song_with_part(0)))

    def test_faint_bleed_is_empty(self):
        # Constant bleed around -60 dBFS never becomes clearly audible.
        assert sa.is_empty(sa.activity_from_samples(song_with_part(0, bleed=0.0014)))

    def test_short_real_part_is_kept(self):
        # A piano playing only a 10 s bridge is a real part.
        assert not sa.is_empty(sa.activity_from_samples(song_with_part(10)))

    def test_full_part_is_kept(self):
        assert not sa.is_empty(sa.activity_from_samples(song_with_part(200)))

    def test_a_blip_under_two_seconds_is_empty(self):
        assert sa.is_empty(sa.activity_from_samples(song_with_part(1.0)))

    def test_quiet_few_seconds_are_bleed(self):
        # 5 s just over the audible line, with the rest silent -> p95 is low.
        assert sa.is_empty(sa.activity_from_samples(song_with_part(5, amp=0.02)))


class TestFindEmptyStems:
    def test_never_reports_every_stem(self, monkeypatch):
        monkeypatch.setattr(sa, 'stem_activity', lambda p: {'audible_secs': 0.0, 'p95_db': -90.0})
        assert sa.find_empty_stems(['a.mp3', 'b.mp3']) == []

    def test_reports_only_the_empty_ones(self, monkeypatch):
        levels = {'piano.mp3': 0.0, 'drums.mp3': 200.0}
        monkeypatch.setattr(
            sa, 'stem_activity', lambda p: {'audible_secs': levels[p], 'p95_db': -20.0}
        )
        assert sa.find_empty_stems(['piano.mp3', 'drums.mp3']) == ['piano.mp3']
