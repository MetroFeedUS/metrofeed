#!/usr/bin/env python3
"""
Traffic Camera Geocoding Script

This script reads traffic_cameras.csv, geocodes camera locations using OpenCage Geocoding API,
and outputs both an updated CSV and a JSON file for frontend consumption.

Usage:
    1. Install dependencies: pip install requests
    2. Set API key: export OPENCAGE_API_KEY="your_api_key_here"
       OR edit the OPENCAGE_API_KEY constant below
    3. Run: python geocode_cameras.py

The script will:
    - Read from: data/traffic_cameras.csv
    - Write to: data/traffic_cameras_with_coords.csv
    - Write to: data/cameras.json
    - Skip cameras that already have coordinates
    - Add a 1-second delay between API calls to respect rate limits
"""

import csv
import json
import os
import time
import requests
from urllib.parse import quote

# ============================================================================
# CONFIGURATION
# ============================================================================

# OpenCage Geocoding API
# Get your free API key at: https://opencagedata.com/api
# You can either:
#   1. Set environment variable: export OPENCAGE_API_KEY="your_key"
#   2. Or uncomment and set the key directly below (not recommended for production)
OPENCAGE_API_KEY = os.getenv('OPENCAGE_API_KEY', '')
OPENCAGE_API_URL = 'https://api.opencagedata.com/geocode/v1/json'

# Alternative: Use Nominatim (free, no API key required, but slower)
# Set USE_NOMINATIM = True to use Nominatim instead of OpenCage
USE_NOMINATIM = False
NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search'

# File paths (relative to script location)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'data')
INPUT_CSV = os.path.join(DATA_DIR, 'traffic_cameras.csv')
OUTPUT_CSV = os.path.join(DATA_DIR, 'traffic_cameras_with_coords.csv')
OUTPUT_JSON = os.path.join(DATA_DIR, 'cameras.json')

# Rate limiting: delay between API calls (seconds)
API_DELAY = 1.0

# ============================================================================
# GEOCODING FUNCTIONS
# ============================================================================

def geocode_with_opencage(query, api_key):
    """Geocode using OpenCage API."""
    if not api_key:
        raise ValueError("OPENCAGE_API_KEY not set. Get a free key at https://opencagedata.com/api")
    
    params = {
        'q': query,
        'key': api_key,
        'limit': 1,
        'no_annotations': 1
    }
    
    try:
        response = requests.get(OPENCAGE_API_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data.get('results') and len(data['results']) > 0:
            result = data['results'][0]
            geometry = result.get('geometry', {})
            return geometry.get('lat'), geometry.get('lng')
        else:
            return None, None
    except Exception as e:
        print(f"  ⚠️  OpenCage API error: {e}")
        return None, None

def geocode_with_nominatim(query):
    """Geocode using Nominatim (OpenStreetMap) API."""
    params = {
        'q': query,
        'format': 'json',
        'limit': 1,
        'addressdetails': 0
    }
    
    headers = {
        'User-Agent': 'MetroFeed Traffic Camera Geocoder'  # Required by Nominatim
    }
    
    try:
        response = requests.get(NOMINATIM_API_URL, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data and len(data) > 0:
            result = data[0]
            return float(result.get('lat')), float(result.get('lon'))
        else:
            return None, None
    except Exception as e:
        print(f"  ⚠️  Nominatim API error: {e}")
        return None, None

def geocode_location(description, city, state, country):
    """Geocode a location using the configured service."""
    # Build query string
    query = f"{description}, {city}, {state}, {country}"
    print(f"  🔍 Geocoding: {query}")
    
    if USE_NOMINATIM:
        lat, lon = geocode_with_nominatim(query)
    else:
        lat, lon = geocode_with_opencage(query, OPENCAGE_API_KEY)
    
    if lat and lon:
        print(f"  ✅ Found: {lat}, {lon}")
        return lat, lon
    else:
        print(f"  ❌ No results found")
        return None, None

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def main():
    print("=" * 70)
    print("Traffic Camera Geocoding Script")
    print("=" * 70)
    print()
    
    # Check if input file exists
    if not os.path.exists(INPUT_CSV):
        print(f"❌ Error: Input file not found: {INPUT_CSV}")
        print(f"   Please ensure traffic_cameras.csv exists in the data/ directory.")
        return
    
    # Check API key if using OpenCage
    if not USE_NOMINATIM and not OPENCAGE_API_KEY:
        print("❌ Error: OPENCAGE_API_KEY not set!")
        print("   Set it with: export OPENCAGE_API_KEY='your_key_here'")
        print("   Or get a free key at: https://opencagedata.com/api")
        return
    
    # Read input CSV
    print(f"📖 Reading: {INPUT_CSV}")
    cameras = []
    
    with open(INPUT_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            cameras.append(row)
    
    print(f"   Found {len(cameras)} cameras")
    print()
    
    # Process each camera
    geocoded_count = 0
    skipped_count = 0
    failed_count = 0
    
    for i, camera in enumerate(cameras, 1):
        camera_id = camera.get('id', 'unknown')
        name = camera.get('name', '')
        description = camera.get('description', name)
        city = camera.get('city', 'Portland')
        state = camera.get('state', 'OR')
        country = camera.get('country', 'USA')
        
        print(f"[{i}/{len(cameras)}] {camera_id}: {name}")
        
        # Check if already geocoded
        existing_lat = camera.get('lat', '').strip()
        existing_lon = camera.get('lon', '').strip()
        
        if existing_lat and existing_lon:
            try:
                float(existing_lat)
                float(existing_lon)
                print(f"  ⏭️  Already has coordinates, skipping")
                skipped_count += 1
                print()
                continue
            except ValueError:
                # Invalid coordinates, re-geocode
                pass
        
        # Geocode
        lat, lon = geocode_location(description, city, state, country)
        
        if lat and lon:
            camera['lat'] = str(lat)
            camera['lon'] = str(lon)
            geocoded_count += 1
        else:
            camera['lat'] = ''
            camera['lon'] = ''
            failed_count += 1
            print(f"  ⚠️  WARNING: Could not geocode {camera_id} - {description}")
        
        # Rate limiting
        if i < len(cameras):
            time.sleep(API_DELAY)
        
        print()
    
    # Write updated CSV
    print("=" * 70)
    print(f"📝 Writing results...")
    print(f"   Geocoded: {geocoded_count}")
    print(f"   Skipped (already had coords): {skipped_count}")
    print(f"   Failed: {failed_count}")
    print()
    
    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Write CSV
    fieldnames = ['id', 'name', 'description', 'city', 'state', 'country', 'url', 'lat', 'lon']
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cameras)
    
    print(f"✅ Wrote: {OUTPUT_CSV}")
    
    # Write JSON (only cameras with coordinates)
    cameras_json = []
    for camera in cameras:
        lat = camera.get('lat', '').strip()
        lon = camera.get('lon', '').strip()
        
        if lat and lon:
            try:
                camera_json = {
                    'id': camera['id'],
                    'name': camera['name'],
                    'description': camera['description'],
                    'city': camera['city'],
                    'state': camera['state'],
                    'country': camera['country'],
                    'url': camera['url'],
                    'lat': float(lat),
                    'lon': float(lon)
                }
                cameras_json.append(camera_json)
            except ValueError:
                # Skip invalid coordinates
                pass
    
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(cameras_json, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Wrote: {OUTPUT_JSON} ({len(cameras_json)} cameras with coordinates)")
    print()
    print("=" * 70)
    print("✅ Geocoding complete!")
    print("=" * 70)

if __name__ == '__main__':
    main()

