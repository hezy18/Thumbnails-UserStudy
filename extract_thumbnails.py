#!/usr/bin/env python3
"""Extract the first frame of each video as a thumbnail JPEG using OpenCV."""

import sys
from pathlib import Path
import cv2

def extract_thumbnails(video_dir: Path, thumb_dir: Path):
    thumb_dir.mkdir(parents=True, exist_ok=True)

    videos = sorted(video_dir.glob("*.mp4"))
    if not videos:
        print(f"No .mp4 files found in {video_dir}")
        return

    print(f"Found {len(videos)} videos in {video_dir}")
    ok, skip, fail = 0, 0, 0

    for video in videos:
        out = thumb_dir / (video.stem + ".jpg")
        if out.exists():
            print(f"  [skip] {video.name} (thumbnail exists)")
            skip += 1
            continue

        cap = cv2.VideoCapture(str(video))
        # Seek to ~1s for a more representative frame
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        cap.set(cv2.CAP_PROP_POS_FRAMES, min(int(fps), int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) - 1))
        ret, frame = cap.read()
        cap.release()

        if ret:
            cv2.imwrite(str(out), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            print(f"  [ok]   {video.name} -> {out.name}")
            ok += 1
        else:
            print(f"  [fail] {video.name}")
            fail += 1

    print(f"\nDone: {ok} extracted, {skip} skipped, {fail} failed")


if __name__ == "__main__":
    base = Path(__file__).parent

    langs = sys.argv[1:] if sys.argv[1:] else ["CH", "EN"]

    for lang in langs:
        video_dir = base / f"videos/a-{lang}"
        thumb_dir = base / f"thumbnail/a-{lang}"
        print(f"\n=== {lang}: {video_dir} -> {thumb_dir} ===")
        extract_thumbnails(video_dir, thumb_dir)
