"""Build the allowlisted static site that Netlify publishes.

Run from the repository root:
    python build_production.py

Only files explicitly listed below, Cincinnati SVG assets, route JSON, and the
camera fallback are copied. Development tools and unreleased city folders stay
outside dist/ and therefore cannot be served by Netlify.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

ROOT_FILES = [
    "Index.html",
    "metrofeedus-home.html",
    "contact.html",
    "terms.html",
    "privacy.html",
    "report.html",
    "dmca.html",
    "mfOpsStats.js",
    "ops-stats.html",
    "RoamRavenNamelogo.svg",
    "manifestbird.png",
    "favicon.ico",
    "metrofeedsimplelogo.png",
    "metrofeedone-hero.png",
    "websitepicture.png",
    "manifest.json",
    "_redirects",
    "_headers",
]

# Copied when present. Index.html already falls back to the remote county file if
# this local copy is absent from the GitHub/Netlify checkout.
OPTIONAL_ROOT_FILES = [
    "national/metro_counties.geojson",
]

CINCINNATI_FILES = [
    # Public pages
    "home.html",
    "AndroidInstructions.html",
    "AppleInstructions.html",
    "tickets.html",
    "resources.html",
    "contact.html",
    "terms.html",
    "privacy.html",
    "report.html",
    "dmca.html",
    "manifest.json",
    "manifestbird.png",
    "favicon.ico",
    "metrofeedsimplelogo.png",
    "cornerlogo2.png",
    # Main application
    "tierConfig.js",
    "translations.js",
    "city-config.js",
    "mfOpsStats.js",
    "nwsServiceAlerts.js",
    "geocodeAutocomplete.js",
    "explorePlaces.js",
    "routes_index.js",
    "metroFeedMap.js",
    "mapBoundsManager.js",
    "cameraIcon.js",
    "routeOverlay.js",
    "trafficIncidents.js",
    "otp.js",
    "savedPlaces.js",
    "trafficCamerasOverlay.js",
    # OBS map, weather bar, and route-alert sources
    "obs-tv.html",
    "obs-tv-panels.js",
    "obs-tv-bootstrap.js",
    "obs-tv-stage.js",
    "obs-tv-bus.js",
    "obs-director.js",
    "obs-support-ticker.js",
    "obs-live-badge.js",
    "obs-tv-slices.js",
    "routes_index.lazy.js",
    "obs-tv.css",
    "obs-tv-stage.css",
    "obs-support-ticker.css",
    "obs-live-badge.css",
]

# If a referenced asset is removed later, this list keeps the warning explicit
# even when the asset is not otherwise required by a newly added page.
KNOWN_MISSING_ASSETS = [
    "manifestbird.png",
    "favicon.ico",
    "metrofeedsimplelogo.png",
    "metrofeedone-hero.png",
    "websitepicture.png",
    "Cincinnati/manifestbird.png",
    "Cincinnati/favicon.ico",
    "Cincinnati/metrofeedsimplelogo.png",
    "Cincinnati/cornerlogo2.png",
]


def copy_required(relative_path: str, destination_relative: str | None = None) -> None:
    source = ROOT / relative_path
    if not source.is_file():
        raise FileNotFoundError(f"Required production file is missing: {relative_path}")

    destination = DIST / (destination_relative or relative_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def copy_optional(relative_path: str) -> bool:
    source = ROOT / relative_path
    if not source.is_file():
        print(f"Warning: optional production file missing: {relative_path}")
        return False
    copy_required(relative_path)
    return True


def copy_cincinnati_file(relative_path: str) -> None:
    copy_required(
        f"Cincinnati/{relative_path}",
        f"Cincinnati/{relative_path}",
    )


def copy_json_directory(source_relative: str, destination_relative: str) -> int:
    source_dir = ROOT / source_relative
    if not source_dir.is_dir():
        raise FileNotFoundError(f"Required production directory is missing: {source_relative}")

    count = 0
    for source in sorted(source_dir.glob("*.json")):
        destination = DIST / destination_relative / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        count += 1

    if count == 0:
        raise RuntimeError(f"No JSON files found in required directory: {source_relative}")
    return count


def verify_exclusions() -> None:
    forbidden_names = {
        "admin.html",
        "build_report.json",
        "resources-builder.html",
        "TrafficCamerasEditor.html",
        "MarketplaceEditor.html",
        "ui-lab.html",
        "sand.html",
        "obs-route-tv.html",
    }
    forbidden_suffixes = {".md", ".py", ".ps1"}
    forbidden_parts = {
        "bluejackets",
        "Columbus",
        "Allen",
        "Toledo",
        "Youngstown",
        "pythonbusroutes",
        "Rail routes",
    }

    violations: list[str] = []
    for path in DIST.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(DIST)
        if (
            path.name in forbidden_names
            or path.suffix.lower() in forbidden_suffixes
            or any(part in forbidden_parts for part in relative.parts)
        ):
            violations.append(relative.as_posix())

    if violations:
        raise RuntimeError(
            "Production build contains forbidden files:\n  " + "\n  ".join(violations)
        )


def clear_dist() -> None:
    if not DIST.exists():
        return
    # Windows may briefly lock dist/ after a local preview server. Prefer rename
    # over a hard delete when the folder is busy.
    try:
        shutil.rmtree(DIST)
        return
    except OSError:
        stale = ROOT / f".dist_stale_{os.getpid()}"
        if stale.exists():
            shutil.rmtree(stale, ignore_errors=True)
        DIST.rename(stale)
        shutil.rmtree(stale, ignore_errors=True)


def main() -> None:
    clear_dist()
    DIST.mkdir()

    for relative_path in ROOT_FILES:
        copy_required(relative_path)

    for relative_path in OPTIONAL_ROOT_FILES:
        copy_optional(relative_path)

    for relative_path in CINCINNATI_FILES:
        copy_cincinnati_file(relative_path)

    # All top-level Cincinnati SVG files are public visual assets. Subfolders
    # are intentionally not traversed, so legacy route directories stay out.
    svg_count = 0
    for source in sorted((ROOT / "Cincinnati").glob("*.svg")):
        destination = DIST / "Cincinnati" / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        svg_count += 1

    route_count = copy_json_directory(
        "Cincinnati/route_data",
        "Cincinnati/route_data",
    )
    copy_required(
        "Cincinnati/data/cameras.json",
        "Cincinnati/data/cameras.json",
    )

    verify_exclusions()

    file_count = sum(1 for path in DIST.rglob("*") if path.is_file())
    print(
        f"Production build complete: {file_count} files "
        f"({route_count} route JSON files, {svg_count} SVG assets)."
    )

    missing = [path for path in KNOWN_MISSING_ASSETS if not (ROOT / path).exists()]
    if missing:
        print("Warning: existing pages reference assets not present in the repository:")
        for path in missing:
            print(f"  - {path}")


if __name__ == "__main__":
    main()
