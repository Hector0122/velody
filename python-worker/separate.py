#!/usr/bin/env python3
"""Velody Stem Separation Worker.

Usage:
    python separate.py <path-to-audio-file>

Output:
    JSON array of stem file paths to stdout.
"""

import sys
import json
import subprocess
import shutil
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "stems"


def separate(audio_path: str) -> list[str]:
    audio_file = Path(audio_path)

    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    song_name = audio_file.stem
    song_output = OUTPUT_DIR / song_name
    song_output.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable, "-m", "demucs",
            "-n", "htdemucs_6s",
            "--mp3",
            "-o", str(OUTPUT_DIR),
            str(audio_file.absolute())
        ],
        capture_output=True, text=True, check=True
    )

    demucs_out = OUTPUT_DIR / "htdemucs_6s" / song_name
    stems = ["vocals", "drums", "bass", "other", "piano", "guitar"]
    stem_paths = []

    for stem in stems:
        src = demucs_out / f"{stem}.mp3"
        dst = song_output / f"{stem}.mp3"
        if src.exists():
            shutil.copy2(str(src), str(dst))
            stem_paths.append(str(dst))
        else:
            raise FileNotFoundError(f"Stem not generated: {src}")

    shutil.rmtree(OUTPUT_DIR / "htdemucs_6s", ignore_errors=True)

    return stem_paths


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file provided"}), file=sys.stderr)
        sys.exit(1)

    try:
        stems = separate(sys.argv[1])
        print(json.dumps(stems))
    except subprocess.CalledProcessError as e:
        print(json.dumps({"error": e.stderr.strip()}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
