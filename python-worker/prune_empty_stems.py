#!/usr/bin/env python3
"""Find (and optionally delete) empty stems in an existing Velody library.

New separations already skip empty stems (separate.py → stem_activity.py);
this applies the same rule to songs separated before that existed.

Usage:
    python prune_empty_stems.py <stems-root>            # dry run: list only
    python prune_empty_stems.py <stems-root> --apply    # delete them

Only Demucs stems (vocals/drums/bass/other/piano/guitar) are considered —
recordings are never touched — and a song always keeps at least one stem.
"""

import os
import sys

from stem_activity import find_empty_stems

STEMS = ('vocals', 'drums', 'bass', 'other', 'piano', 'guitar')


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    root, apply = args[0], '--apply' in args
    total_files = total_bytes = 0
    for song in sorted(os.listdir(root)):
        song_dir = os.path.join(root, song)
        if not os.path.isdir(song_dir):
            continue
        paths = [
            os.path.join(song_dir, f)
            for f in sorted(os.listdir(song_dir))
            if os.path.splitext(f)[0] in STEMS and f.endswith(('.mp3', '.wav'))
        ]
        if not paths:
            continue
        empty = find_empty_stems(paths)
        if not empty:
            continue
        names = ', '.join(os.path.splitext(os.path.basename(p))[0] for p in empty)
        print(f'{song}: {names}')
        for p in empty:
            total_files += 1
            total_bytes += os.path.getsize(p)
            if apply:
                os.remove(p)
    verb = 'Deleted' if apply else 'Would delete'
    print(f'\n{verb} {total_files} empty stems ({total_bytes / 1e6:.0f} MB).')
    if not apply and total_files:
        print('Run again with --apply to delete them.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
