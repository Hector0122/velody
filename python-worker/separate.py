#!/usr/bin/env python3
"""Velody Stem Separation Worker.

Usage:
    python separate.py <path-to-audio-file> [--job-id <uuid>]

Output:
    JSON progress and completion lines to stdout.
    {"type": "progress", "percent": 45}
    {"type": "complete", "stems": [...]}
    {"type": "error", "message": "..."}
"""

import sys
import json
import subprocess
import shutil
import re
import tempfile
import uuid
from pathlib import Path

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "stems"


def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def separate(audio_path: str, job_id: str, output_dir: str | None = None) -> list[str]:
    audio_file = Path(audio_path)

    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    song_name = audio_file.stem
    output_base = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    song_output = output_base / song_name
    song_output.mkdir(parents=True, exist_ok=True)

    # Unique temp directory per job to avoid collisions
    temp_dir = Path(tempfile.mkdtemp(prefix=f"htdemucs_6s_{job_id}_"))
    demucs_out = temp_dir / "htdemucs_6s" / song_name

    proc = subprocess.Popen(
        [
            sys.executable, "-m", "demucs",
            "-n", "htdemucs_6s",
            "--mp3",
            "-o", str(temp_dir),
            str(audio_file.absolute())
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Parse Demucs progress from stderr (tqdm output)
    # Pattern: "100%|..." or " 67%|..."
    progress_pattern = re.compile(r"(\d+)%")

    last_percent = 0

    if proc.stderr:
        for line in proc.stderr:
            line = line.strip()
            if not line:
                continue
            match = progress_pattern.search(line)
            if match:
                percent = int(match.group(1))
                if percent != last_percent:
                    last_percent = percent
                    # Each track is 1/6 ≈ 16.67% of total
                    _emit({"type": "progress", "percent": percent})

    proc.wait()

    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, proc.args)

    _emit({"type": "progress", "percent": 100})

    stems = ["vocals", "drums", "bass", "other", "piano", "guitar"]
    stem_paths = []

    for stem in stems:
        src = demucs_out / f"{stem}.mp3"
        dst = song_output / f"{stem}.mp3"
        if src.exists():
            shutil.copy2(str(src), str(dst))
            stem_paths.append(str(dst))
        else:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise FileNotFoundError(f"Stem not generated: {src}")

    shutil.rmtree(temp_dir, ignore_errors=True)

    return stem_paths


if __name__ == "__main__":
    if len(sys.argv) < 2:
        _emit({"type": "error", "message": "No audio file provided"})
        sys.exit(1)

    audio_path = sys.argv[1]

    job_id = str(uuid.uuid4())
    output_dir = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--job-id' and i + 1 < len(args):
            i += 1
            job_id = args[i]
        elif args[i] == '--output-dir' and i + 1 < len(args):
            i += 1
            output_dir = args[i]
        i += 1

    try:
        stems = separate(audio_path, job_id, output_dir)
        _emit({"type": "complete", "stems": stems})
    except subprocess.CalledProcessError as e:
        _emit({"type": "error", "message": e.stderr.strip() if e.stderr else str(e)})
        sys.exit(1)
    except Exception as e:
        _emit({"type": "error", "message": str(e)})
        sys.exit(1)
