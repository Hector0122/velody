#!/usr/bin/env python3
"""Velody Stem Separation Worker.

Usage:
    python separate.py <path-to-audio-file>

Output:
    JSON array of stem file paths to stdout.
"""

import sys
import json
from pathlib import Path


def separate(audio_path: str) -> list[str]:
    audio_file = Path(audio_path)

    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    output_dir = Path(__file__).parent.parent / "output" / "stems" / audio_file.stem
    output_dir.mkdir(parents=True, exist_ok=True)

    stems = ["vocals", "drums", "bass", "other"]
    stem_paths = []

    for stem in stems:
        stem_path = output_dir / f"{stem}.wav"
        stem_paths.append(str(stem_path))

    # TODO: Demucs execution
    # import subprocess
    # result = subprocess.run(
    #     ["python3", "-m", "demucs", "--two-stems=vocals", "-o", str(output_dir), str(audio_file)],
    #     capture_output=True, text=True, check=True
    # )

    return stem_paths


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file provided"}), file=sys.stderr)
        sys.exit(1)

    try:
        stems = separate(sys.argv[1])
        print(json.dumps(stems))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
