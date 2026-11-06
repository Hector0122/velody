import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chords import CHORDS, FRAME_SEC, beat_chords, chord_changes  # noqa: E402


def _frames(per_beat: list, beat_sec: float = 0.5) -> tuple:
    """Frame probabilities holding each beat's distribution, plus the beat times."""
    frames_per_beat = int(round(beat_sec / FRAME_SEC))
    probs = np.concatenate([np.tile(p, (frames_per_beat, 1)) for p in per_beat])
    beats = [i * frames_per_beat * FRAME_SEC for i in range(len(per_beat))]
    return probs, beats


def _dist(**weights) -> np.ndarray:
    p = np.full(len(CHORDS), 0.001)
    for name, w in weights.items():
        p[CHORDS.index(name.replace('_sharp', '#'))] = w
    return p / p.sum()


def test_near_tie_goes_to_the_chord_the_song_uses():
    # A power chord (no third): E barely ahead of Em on one beat, in a song
    # that is otherwise clearly in Em.
    per_beat = [_dist(Em=0.9)] * 9 + [_dist(E=0.48, Em=0.45)]
    probs, beats = _frames(per_beat)
    assert beat_chords(probs, beats)[-1] == 'Em'


def test_a_clear_out_of_key_chord_survives():
    # Caifanes' F in an Em song: confidently predicted, so the prior can't erase it.
    per_beat = [_dist(Em=0.9)] * 9 + [_dist(F=0.9, Em=0.05)]
    probs, beats = _frames(per_beat)
    assert beat_chords(probs, beats)[-1] == 'F'


def test_chord_changes_keeps_only_the_changes():
    assert chord_changes([0, 0.5, 1, 1.5], ['Em', 'Em', 'D', 'D']) == [
        {'time': 0.0, 'chord': 'Em'},
        {'time': 1.0, 'chord': 'D'},
    ]
