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
import signal
import tempfile
import uuid
from pathlib import Path

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "stems"


def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


ALLOWED_BITRATES = (128, 192, 320)
DEFAULT_BITRATE = 128


def separate(
    audio_path: str, job_id: str, output_dir: str | None = None, bitrate: int = DEFAULT_BITRATE
) -> list[str]:
    audio_file = Path(audio_path)

    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    song_name = audio_file.stem
    output_base = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    song_output = output_base / song_name
    song_output.mkdir(parents=True, exist_ok=True)

    # Unique temp directory per job to avoid collisions. Always removed, even on
    # failure/timeout/cancel, so aborted runs don't leak stems into the temp dir.
    temp_dir = Path(tempfile.mkdtemp(prefix=f"htdemucs_6s_{job_id}_"))
    try:
        return _run_demucs(audio_file, song_name, song_output, temp_dir, bitrate)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _run_demucs(
    audio_file: Path, song_name: str, song_output: Path, temp_dir: Path, bitrate: int
) -> list[str]:
    demucs_out = temp_dir / "htdemucs_6s" / song_name

    proc = subprocess.Popen(
        [
            sys.executable, "-m", "demucs",
            "-n", "htdemucs_6s",
            "--mp3",
            # Chosen per song in the UI: 128 kbps ~23 MB / 192 ~35 MB / 320 ~58 MB
            # for the 6 stems of a 4-min song.
            "--mp3-bitrate", str(bitrate),
            "-o", str(temp_dir),
            str(audio_file.absolute())
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True
    )

    # Parse Demucs progress from stderr (tqdm output), e.g. " 67%|...".
    progress_pattern = re.compile(r"(\d+)%")
    last_percent = 0
    tail: list[str] = []  # last stderr lines, surfaced if Demucs fails

    try:
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.strip()
            if not line:
                continue
            match = progress_pattern.search(line)
            if match:
                percent = int(match.group(1))
                if percent != last_percent:
                    last_percent = percent
                    _emit({"type": "progress", "percent": percent})
            else:
                tail = (tail + [line])[-5:]
        proc.wait()
    finally:
        # If we're aborted (SIGTERM from the app), don't leave Demucs running orphaned.
        if proc.poll() is None:
            proc.kill()
            proc.wait()

    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, proc.args, stderr="\n".join(tail))

    _emit({"type": "progress", "percent": 100})

    stems = ["vocals", "drums", "bass", "other", "piano", "guitar"]
    stem_paths = []

    for stem in stems:
        src = demucs_out / f"{stem}.mp3"
        dst = song_output / f"{stem}.mp3"
        if not src.exists():
            raise FileNotFoundError(f"Stem not generated: {src}")
        shutil.move(str(src), str(dst))
        stem_paths.append(str(dst))

    return stem_paths


if __name__ == "__main__":
    # The app stops us with SIGTERM on cancel/timeout; turn it into SystemExit so
    # the finally-block cleanup in separate() still runs.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))

    if len(sys.argv) < 2:
        _emit({"type": "error", "message": "No audio file provided"})
        sys.exit(1)

    audio_path = sys.argv[1]

    job_id = str(uuid.uuid4())
    output_dir = None
    bitrate = DEFAULT_BITRATE
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--job-id' and i + 1 < len(args):
            i += 1
            job_id = args[i]
        elif args[i] == '--output-dir' and i + 1 < len(args):
            i += 1
            output_dir = args[i]
        elif args[i] == '--bitrate' and i + 1 < len(args):
            i += 1
            try:
                bitrate = int(args[i])
            except ValueError:
                pass
            if bitrate not in ALLOWED_BITRATES:
                bitrate = DEFAULT_BITRATE
        i += 1

    try:
        stems = separate(audio_path, job_id, output_dir, bitrate)
        _emit({"type": "complete", "stems": stems})
    except subprocess.CalledProcessError as e:
        _emit({"type": "error", "message": e.stderr.strip() if e.stderr else str(e)})
        sys.exit(1)
    except Exception as e:
        _emit({"type": "error", "message": str(e)})
        sys.exit(1)
