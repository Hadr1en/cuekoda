"""Prepare expert EDM cues from the TU Delft SSMe archive for CueKoda experiments."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from mutagen.mp3 import MP3
import numpy as np
from scipy.io import loadmat


LABELS = {"drop": "drop", "break_start": "breakdown", "build_start": "buildup"}


def split(track_id):
    value = hashlib.sha256(f"cuekoda-ssme-v1:{track_id}".encode()).digest()[0] / 256
    if value < 0.68:
        return "train"
    if value < 0.84:
        return "development"
    return "test"


def expert_marks(annotation, duration):
    values = loadmat(annotation, squeeze_me=True, variable_names=list(LABELS))
    marks = {}
    for column, label in LABELS.items():
        seconds = np.asarray(values.get(column, []), dtype=float).ravel()
        # The released arrays use zero for an empty annotation. Times are rounded to seconds.
        marks[label] = sorted({float(t) for t in seconds if np.isfinite(t) and 0 < t <= duration})
    return marks


def prepare(directory):
    rows = []
    seen = set()
    skipped = Counter()
    for annotation in sorted(directory.glob("*.mat")):
        audio = annotation.with_suffix(".mp3")
        if not audio.is_file():
            skipped["missingAudio"] += 1
            continue
        duration = MP3(audio).info.length
        if not 20 <= duration < 1200:
            skipped["durationOutOfRange"] += 1
            continue

        marks = expert_marks(annotation, duration)
        if not any(marks.values()):
            skipped["missingExpertMarks"] += 1
            continue

        with audio.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest in seen:
            skipped["duplicateAudio"] += 1
            continue
        seen.add(digest)
        rows.append({
            "id": annotation.stem,
            "fileName": audio.name,
            "duration": duration,
            "split": split(annotation.stem),
            "sha256": digest,
            "marks": marks,
        })
    return rows, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="extracted directory containing the MP3 and MAT pairs")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    tracks, skipped = prepare(args.directory)
    if not tracks:
        parser.error("no usable audio and expert annotation pairs")
    summary = {"tracks": len(tracks), "splits": dict(Counter(r["split"] for r in tracks)), "skipped": dict(skipped)}
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump({"source": "SSMe", "summary": summary, "tracks": tracks}, stream, indent=2)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
