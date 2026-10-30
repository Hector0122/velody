#!/usr/bin/env python3
"""Velody URL Download Worker.

Usage:
    python download.py <url> [--ffmpeg-path <path>] [--mode audio|video]

Output:
    JSON lines to stdout (same protocol as separate.py).
    {"type": "metadata", "title": "...", "duration": 240}
    {"type": "progress", "percent": 45}
    {"type": "complete", "path": "/abs/path/to/downloaded.mp3", "title": "..."}
    {"type": "error", "message": "..."}
"""

import sys
import json
import re
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


def _clean_youtube_url(url: str) -> str:
    if 'youtube.com' in url or 'youtu.be' in url:
        url = re.sub(r'[&?]list=[^&]*', '', url)
        url = re.sub(r'[&?]index=[^&]*', '', url)
    return url


VIDEO_EXTENSIONS = ('.mp4', '.mkv', '.webm')
AUDIO_EXTENSIONS = ('.mp3', '.wav', '.flac', '.m4a', '.ogg')


def download_audio(url: str, ffmpeg_path: str | None = None, mode: str = "audio") -> dict:
    tmp_dir = tempfile.mkdtemp(prefix="velody_dl_")
    output_path = str(Path(tmp_dir) / "%(title)s.%(ext)s")

    clean_url = _clean_youtube_url(url)

    ydl_opts = {
        'outtmpl': output_path,
        'progress_hooks': [progress_hook],
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
    }

    if mode == "video":
        ydl_opts['format'] = 'bv*+ba/b'
        ydl_opts['merge_output_format'] = 'mp4'
    else:
        ydl_opts['format'] = 'ba/b/worst*'
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '0',
        }]

    if ffmpeg_path and ('/' in ffmpeg_path or '\\' in ffmpeg_path):
        ydl_opts['ffmpeg_location'] = str(Path(ffmpeg_path).parent)

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(clean_url, download=False)
        title = info.get('title', 'untitled')
        duration = info.get('duration', 0)

        _emit({"type": "metadata", "title": title, "duration": duration})

        ydl.download([clean_url])

    # Find the downloaded file
    wanted_exts = VIDEO_EXTENSIONS if mode == "video" else AUDIO_EXTENSIONS
    downloaded_files = [f for f in Path(tmp_dir).glob("*.*") if f.suffix in wanted_exts]

    if not downloaded_files:
        raise FileNotFoundError(f"Download completed but no {mode} file found")

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
    mode = "audio"

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--ffmpeg-path' and i + 1 < len(args):
            i += 1
            ffmpeg_path = args[i]
        elif args[i] == '--mode' and i + 1 < len(args):
            i += 1
            mode = args[i]
        i += 1

    try:
        result = download_audio(url, ffmpeg_path, mode)
        _emit({"type": "complete", "path": result["path"], "title": result["title"]})
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if "Private video" in error_msg:
            _emit({"type": "error", "message": "This video is private"})
        elif "Video unavailable" in error_msg:
            _emit({"type": "error", "message": "Video unavailable"})
        elif "Sign in" in error_msg:
            _emit({"type": "error", "message": "This video requires sign-in (age-restricted or private)"})
        elif "403" in error_msg or "Forbidden" in error_msg:
            _emit({"type": "error", "message": "[UPDATE_YTDLP] YouTube blocked the download. yt-dlp needs to be updated."})
        elif "format" in error_msg.lower() and "not available" in error_msg.lower():
            _emit({"type": "error", "message": "No downloadable audio format found for this video"})
        else:
            _emit({"type": "error", "message": f"Download failed: {error_msg[:200]}"})
        sys.exit(1)
    except Exception as e:
        _emit({"type": "error", "message": str(e)})
        sys.exit(1)
