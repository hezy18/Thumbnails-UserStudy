#!/usr/bin/env python3
"""
Generate thumbnail_manifest.json for the UserStudyPlatform.

Run this script after fetching/copying thumbnails to update the manifest.
The app.js loads this manifest to discover available thumbnail files
dynamically, especially shot*_klive, shot*_showme, and shot*_hecate variants.

Usage:
    python3 generate_manifest.py
"""
import os
import json
import re

BASE = os.path.dirname(os.path.abspath(__file__))
THUMB_BASE = os.path.join(BASE, 'thumbnail')
OUT = os.path.join(BASE, 'thumbnail_manifest.json')

# Static filenames that are always included if present
STATIC_FILES = {
    'best_extra_high.jpg', 'best_high.jpg', 'best_low.jpg',
    'best_medium.jpg', 'best_ori.jpg', 'hpcvtg.jpg',
    'initial.jpg', 'PosterO.jpg',
}

# Dynamic pattern: shot*_klive.jpg, shot*_showme.jpg, shot*_hecate.jpg
SHOT_PATTERN = re.compile(r'^shot\d+_(klive|showme|hecate)\.jpg$')

manifest = {}

for folder in ['b-ZH', 'b-EN']:
    folder_path = os.path.join(THUMB_BASE, folder)
    if not os.path.isdir(folder_path):
        continue
    manifest[folder] = {}
    for user in sorted(os.listdir(folder_path)):
        user_path = os.path.join(folder_path, user)
        if not os.path.isdir(user_path):
            continue
        manifest[folder][user] = {}
        for vid in sorted(os.listdir(user_path)):
            vid_path = os.path.join(user_path, vid)
            if not os.path.isdir(vid_path):
                continue
            static = []
            shot_files = []
            for f in os.listdir(vid_path):
                if f in STATIC_FILES:
                    static.append(f)
                elif SHOT_PATTERN.match(f):
                    shot_files.append(f)
            shot_files.sort()
            manifest[folder][user][vid] = static + shot_files

with open(OUT, 'w') as fp:
    json.dump(manifest, fp, indent=2, ensure_ascii=False)

total = sum(
    len(vids)
    for users in manifest.values()
    for vids in users.values()
)
print(f"Manifest written to {OUT}")
print(f"Folders: {list(manifest.keys())}, total video entries: {total}")
