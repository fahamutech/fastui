#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont


def arguments():
    parser = argparse.ArgumentParser(description="Compare Figma reference exports with generated app screenshots.")
    parser.add_argument("figma_cache", type=Path)
    parser.add_argument("figma_images", type=Path)
    parser.add_argument("react_images", type=Path)
    parser.add_argument("flutter_images", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def surface_records(cache_path):
    document = json.loads(cache_path.read_text())
    records = []
    for canvas in document.get("document", {}).get("children", []):
        if canvas.get("type") != "CANVAS":
            continue
        for node in canvas.get("children", []):
            if node.get("type") != "FRAME" or node.get("visible", True) is False:
                continue
            surface = node["name"].split("[")[0].strip()
            suffix = "_dialog" if surface.endswith("_dialog") else "_page"
            route = surface[: -len(suffix)] if surface.endswith(suffix) else surface
            box = node.get("absoluteBoundingBox", {})
            records.append({
                "surface": surface,
                "route": route,
                "width": round(box.get("width", 1440)),
                "height": round(box.get("height", 960)),
            })
    return records


def reference_image(root, record):
    preferred = list((root / "by-route" / record["route"]).rglob("*.png"))
    candidates = preferred or [
        candidate
        for candidate in root.rglob("*.png")
        if str(candidate.relative_to(root)).startswith(record["surface"])
    ]
    sized = []
    for candidate in candidates:
        try:
            with Image.open(candidate) as image:
                if image.size == (record["width"], record["height"]):
                    sized.append(candidate)
        except OSError:
            pass
    if not sized:
        raise FileNotFoundError(f'No {record["width"]}x{record["height"]} reference for {record["surface"]}')
    return sized[0]


def normalized_difference(reference, actual):
    reference_array = np.asarray(reference.convert("RGB"), dtype=np.float32)
    actual_array = np.asarray(actual.convert("RGB"), dtype=np.float32)
    delta = np.abs(reference_array - actual_array)
    return {
        "mean_absolute_error": round(float(delta.mean() / 255), 6),
        "pixels_over_10_percent": round(float((delta.max(axis=2) > 25.5).mean()), 6),
    }


def flatten(image):
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image.convert("RGB")


def thumbnail(image, width=320):
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def make_sheet(rows, output_path):
    label_height = 30
    gap = 10
    thumb_width = 320
    row_heights = [max(item.height for item in images) + label_height + gap for _, images in rows]
    sheet = Image.new("RGB", (thumb_width * 3 + gap * 4, sum(row_heights) + 40), "#202124")
    draw = ImageDraw.Draw(sheet)
    draw.text((gap, 10), "Figma", fill="white")
    draw.text((thumb_width + gap * 2, 10), "React", fill="white")
    draw.text((thumb_width * 2 + gap * 3, 10), "Flutter", fill="white")
    y = 40
    for (surface, images), row_height in zip(rows, row_heights):
        draw.text((gap, y), surface, fill="white")
        image_y = y + label_height
        for column, item in enumerate(images):
            sheet.paste(item, (gap + column * (thumb_width + gap), image_y))
        y += row_height
    sheet.save(output_path)


def main():
    args = arguments()
    args.output.mkdir(parents=True, exist_ok=True)
    report = []
    rows = []
    for record in surface_records(args.figma_cache):
        reference_path = reference_image(args.figma_images, record)
        react_path = args.react_images / f'{record["surface"]}.png'
        flutter_path = args.flutter_images / f'{record["surface"]}.png'
        with Image.open(reference_path) as reference_source, Image.open(react_path) as react_source, Image.open(flutter_path) as flutter_source:
            reference = flatten(reference_source)
            react = react_source.convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
            flutter = flutter_source.convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
            report.append({
                **record,
                "reference": str(reference_path),
                "react": normalized_difference(reference, react),
                "flutter": normalized_difference(reference, flutter),
            })
            rows.append((record["surface"], [thumbnail(reference), thumbnail(react), thumbnail(flutter)]))
            for platform, actual in (("react", react), ("flutter", flutter)):
                difference = ImageChops.difference(reference, actual)
                difference.save(args.output / f'{record["surface"]}.{platform}.diff.png')

    make_sheet(rows[:9], args.output / "contact-sheet-1.png")
    make_sheet(rows[9:18], args.output / "contact-sheet-2.png")
    make_sheet(rows[18:], args.output / "contact-sheet-3.png")
    report.sort(key=lambda item: item["react"]["mean_absolute_error"] + item["flutter"]["mean_absolute_error"], reverse=True)
    (args.output / "report.json").write_text(json.dumps(report, indent=2))
    print(f"Compared {len(report)} surfaces. Report: {args.output / 'report.json'}")


if __name__ == "__main__":
    main()
