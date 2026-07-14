#!/usr/bin/env python3
"""Velody URL Download Worker.

Usage:
    python download.py <url> [--ffmpeg-path <path>]

Output:
    JSON lines to stdout (same protocol as separate.py).
    {"type": "metadata", "title": "...", "duration": 240}
    {"type": "progress", "percent": 45}
    {"type": "complete", "path": "/abs/path/to/downloaded.mp3", "title": "..."}
    {"type": "error", "message": "..."}
"""

import sys
import json
import tempfile
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    print(json.dumps({"type": "error", "message": "yt-dlp not installed. Run setup to enable URL import."}), flush=True)
    sys.exit(1)


def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def progress_hook(d):
    if d['status'] == 'downloading':
        total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
        downloaded = d.get('downloaded_bytes', 0)
        if total > 0:
            pct = min(99, int(downloaded / total * 100))
            _emit({"type": "progress", "percent": pct})
    elif d['status'] == 'finished':
        _emit({"type": "progress", "percent": 100})


def download_audio(url: str, ffmpeg_path: str | None = None) -> dict:
    tmp_dir = tempfile.mkdtemp(prefix="velody_dl_")
    output_path = str(Path(tmp_dir) / "%(title)s.%(ext)s")

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_path,
        'progress_hooks': [progress_hook],
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '0',
        }],
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
    }

    if ffmpeg_path and ('/' in ffmpeg_path or '\\' in ffmpeg_path):
        ydl_opts['ffmpeg_location'] = str(Path(ffmpeg_path).parent)

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        title = info.get('title', 'untitled')
        duration = info.get('duration', 0)

        _emit({"type": "metadata", "title": title, "duration": duration})

        ydl.download([url])

    # Find the downloaded MP3 file
    downloaded_files = list(Path(tmp_dir).glob("*.mp3"))
    if not downloaded_files:
        # Try any audio file
        downloaded_files = list(Path(tmp_dir).glob("*.*"))
        downloaded_files = [f for f in downloaded_files if f.suffix in ('.mp3', '.wav', '.flac', '.m4a', '.ogg')]

    if not downloaded_files:
        raise FileNotFoundError("Download completed but no audio file found")

    return {
        "path": str(downloaded_files[0]),
        "title": title,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        _emit({"type": "error", "message": "No URL provided"})
        sys.exit(1)

    url = sys.argv[1]
    ffmpeg_path = None

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--ffmpeg-path' and i + 1 < len(args):
            i += 1
            ffmpeg_path = args[i]
        i += 1

    try:
        result = download_audio(url, ffmpeg_path)
        _emit({"type": "complete", "path": result["path"], "title": result["title"]})
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if "Private video" in error_msg:
            _emit({"type": "error", "message": "This video is private"})
        elif "Video unavailable" in error_msg:
            _emit({"type": "error", "message": "Video unavailable"})
        elif "Sign in" in error_msg:
            _emit({"type": "error", "message": "This video requires sign-in (age-restricted or private)"})
        else:
            _emit({"type": "error", "message": f"Download failed: {error_msg[:200]}"})
        sys.exit(1)
    except Exception as e:
        _emit({"type": "error", "message": str(e)})
        sys.exit(1)
