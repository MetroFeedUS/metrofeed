#!/usr/bin/env python3
"""
================================================================================
DEPRECATED – Camera locations are now managed via the Traffic Cameras Editor
and cameras.json only.
================================================================================

This script is no longer used. Camera locations are now managed through:
1. The Traffic Cameras Editor page (TrafficCameras.html)
2. Manual pin placement on the map
3. Export to data/cameras.json

No Python, CSV, or geocoding APIs are used anymore.

================================================================================
OLD DOCUMENTATION (kept for reference only):
================================================================================

Traffic Camera Geocoding Script

This script reads traffic_cameras.csv, geocodes camera locations using OpenCage Geocoding API
or Nominatim (OpenStreetMap), and outputs both an updated CSV and a JSON file for frontend consumption.

================================================================================
NOMINATIM USAGE POLICY COMPLIANCE
================================================================================
When using Nominatim (OpenStreetMap's geocoding service), this script is fully
compliant with the official Nominatim Usage Policy:
  https://operations.osmfoundation.org/policies/nominatim/

Compliance features:
  ✓ Custom User-Agent header identifying the application and contact email
  ✓ Minimum 1.0 second delay between all Nominatim requests
  ✓ Single-threaded execution (no parallel or async requests)
  ✓ Results are cached (skips cameras that already have coordinates)
  ✓ Respectful rate limiting to avoid overloading the service

For Nominatim usage, please:
  - Use this script responsibly and only for legitimate purposes
  - Do not modify the rate limiting or concurrency settings
  - Respect the service and its volunteers who maintain it
================================================================================

Usage:
    1. Install dependencies: pip install requests
    2. For OpenCage: Set API key: export OPENCAGE_API_KEY="your_api_key_here"
       OR edit the OPENCAGE_API_KEY constant below
    3. For Nominatim: Set USE_NOMINATIM = True (no API key needed)
    4. Run: python geocode_cameras.py

The script will:
    - Read from: data/traffic_cameras.csv
    - Write to: data/traffic_cameras_with_coords.csv
    - Write to: data/cameras.json
    - Skip cameras that already have coordinates (caching)
    - Add a 1-second delay between API calls to respect rate limits
"""

import csv
import json
import os
import re
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
USE_NOMINATIM = True  # Set to True to use free Nominatim (no API key needed)
NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search'

# File paths (relative to script location)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'data')
INPUT_CSV = os.path.join(DATA_DIR, 'traffic_cameras.csv')
OUTPUT_CSV = os.path.join(DATA_DIR, 'traffic_cameras_with_coords.csv')
OUTPUT_JSON = os.path.join(DATA_DIR, 'cameras.json')

# Rate limiting: delay between API calls (seconds)
# For Nominatim compliance, this MUST be at least 1.0 second
API_DELAY = 1.0

# Nominatim User-Agent (required by Nominatim Usage Policy)
# Must identify the application and provide contact information
NOMINATIM_USER_AGENT = "MetroFeed-Geocoder/1.0 (connect.metrofeed@outlook.com)"

# ============================================================================
# GEOCODING FUNCTIONS
# ============================================================================

def build_nominatim_queries(row: dict) -> list[str]:
    """
    Convert DOT-style camera descriptions into natural language queries
    that Nominatim can better understand.
    
    Examples:
        "I-84 at Lloyd Blvd" → "Interstate 84 at Lloyd Boulevard, Portland, Oregon, USA"
        "I-5 at Terwilliger" → "Interstate 5 and Terwilliger Boulevard, Portland, Oregon, USA"
        "US 26 at Zoo Bridge" → "U.S. Route 26 at Zoo Bridge, Portland, Oregon, USA"
    
    Returns a list of query variations to try (most specific first).
    """
    description = row.get('description', '').strip()
    city = row.get('city', 'Portland')
    state = row.get('state', 'OR')
    country = row.get('country', 'USA')
    
    # Start with the description
    query = description
    
    # Convert highway abbreviations to full names (do this first, before word tokenization)
    query = query.replace('I-5', 'Interstate 5')
    query = query.replace('I-84', 'Interstate 84')
    query = query.replace('I-205', 'Interstate 205')
    query = query.replace('US 26', 'U.S. Route 26')
    query = query.replace('US-26', 'U.S. Route 26')
    
    # Tokenize the query into words to avoid replacing substrings within words
    # Split by whitespace, preserving the structure
    words = query.split()
    cleaned_words = []
    
    # Abbreviation mapping (only apply to whole words)
    abbrev_map = {
        'Blvd': 'Boulevard',
        'blvd': 'Boulevard',
        'St': 'Street',
        'st': 'Street',
        'Ave': 'Avenue',
        'ave': 'Avenue',
        'Dr': 'Drive',
        'dr': 'Drive',
        'WB': '',  # Remove direction suffixes
        'SB': '',
        'NB': '',
        'EB': '',
        'westbound': '',
        'southbound': '',
        'northbound': '',
        'eastbound': ''
    }
    
    # Process each word
    for word in words:
        # Strip trailing punctuation (like commas) for matching, but preserve it
        word_clean = word.rstrip('.,;:!?')
        punctuation = word[len(word_clean):] if len(word) > len(word_clean) else ''
        
        # Check if the word (without punctuation) matches an abbreviation
        if word_clean in abbrev_map:
            replacement = abbrev_map[word_clean]
            if replacement:  # If not empty (direction suffixes are removed)
                cleaned_words.append(replacement + punctuation)
            # If empty (direction suffix), skip adding it
        else:
            # Check for direction suffixes at the end of words (e.g., "122ndWB" or "122nd WB")
            # First check if it ends with direction suffix directly
            if word_clean.endswith(('WB', 'SB', 'NB', 'EB')):
                # Check if there's a space before the suffix
                if len(word_clean) > 2 and word_clean[-3] == ' ':
                    word_clean = word_clean[:-3].strip()
                else:
                    # No space, just remove the last 2 characters
                    word_clean = word_clean[:-2].strip()
                cleaned_words.append(word_clean + punctuation)
            else:
                cleaned_words.append(word)
    
    # Rejoin the words
    query = ' '.join(cleaned_words)
    
    # Clean up any double spaces that might have been created
    query = re.sub(r'\s+', ' ', query).strip()
    
    # Handle specific street name patterns
    # Numbers with "th", "nd", "rd", "st" suffixes (e.g., "122nd", "181st")
    # Pattern: number followed by th/nd/rd/st, optionally followed by space and direction
    query = re.sub(r'(\d+)(th|nd|rd|st)(\s+(WB|SB|NB|EB|westbound|southbound|northbound|eastbound))?', 
                   r'\1\2 Avenue', query, flags=re.IGNORECASE)
    
    # Handle specific known locations
    if 'Terwilliger' in query and 'Boulevard' not in query:
        query = query.replace('Terwilliger', 'Terwilliger Boulevard')
    
    if 'Lloyd' in query and 'Boulevard' not in query:
        query = query.replace('Lloyd', 'Lloyd Boulevard')
    
    if 'Glisan' in query and 'Street' not in query:
        query = query.replace('Glisan', 'Glisan Street')
    
    if 'Fremont' in query and 'Street' not in query:
        query = query.replace('Fremont', 'Fremont Street')
    
    # Handle "Broadway N" → "Broadway"
    query = re.sub(r'Broadway\s+N\b', 'Broadway', query, flags=re.IGNORECASE)
    
    # Build the full query with location context
    # Try "at" first, then "and" as alternative
    queries = []
    
    # Primary query: use "at" if present, otherwise use "and" for intersections
    if ' at ' in query.lower():
        primary_query = f"{query}, {city}, {state}, {country}"
    else:
        # For intersections, try "and" instead of "at"
        primary_query = query.replace(' at ', ' and ')
        primary_query = f"{primary_query}, {city}, {state}, {country}"
    
    queries.append(primary_query)
    
    # Alternative: try with "and" instead of "at" for intersections
    if ' at ' in query.lower():
        alt_query = query.replace(' at ', ' and ')
        alt_query = f"{alt_query}, {city}, {state}, {country}"
        if alt_query != primary_query:
            queries.append(alt_query)
    
    # Alternative: try without the cross street, just the highway
    if ' at ' in query.lower() or ' and ' in query.lower():
        highway_only = re.sub(r'\s+(at|and)\s+.*', '', query)
        highway_query = f"{highway_only}, {city}, {state}, {country}"
        if highway_query not in queries:
            queries.append(highway_query)
    
    return queries

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
    """
    Geocode using Nominatim (OpenStreetMap) API.
    
    This function is fully compliant with Nominatim Usage Policy:
    - Uses custom User-Agent header with application name and contact email
    - Single-threaded execution (called sequentially from main loop)
    - Rate limiting is handled by the caller (1.0 second delay between calls)
    - Results are cached (caller skips cameras with existing coordinates)
    
    Returns:
        Tuple of (lat, lon) if successful, or (None, None) if not found
    """
    params = {
        'q': query,
        'format': 'json',
        'limit': 1,
        'addressdetails': 0
    }
    
    # Nominatim Usage Policy requires a custom User-Agent header
    # that identifies the application and provides contact information
    headers = {
        'User-Agent': NOMINATIM_USER_AGENT
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

def geocode_with_nominatim_multiple(queries: list[str]) -> tuple:
    """
    Try multiple query variations with Nominatim until one succeeds.
    
    This function is fully compliant with Nominatim Usage Policy:
    - Uses the same User-Agent header as geocode_with_nominatim()
    - Single-threaded execution (tries queries sequentially)
    - Rate limiting: 1.0 second delay between each HTTP request
    - Returns first successful result, or (None, None) if all fail
    
    Args:
        queries: List of query strings to try (in order, most specific first)
    
    Returns:
        Tuple of (lat, lon) if successful, or (None, None) if all queries fail
    """
    for i, query in enumerate(queries):
        # Add delay between requests (except for the first one, delay is handled by caller)
        if i > 0:
            time.sleep(API_DELAY)
        
        lat, lon = geocode_with_nominatim(query)
        
        if lat and lon:
            return lat, lon
        else:
            print(f"  ❌ No results for: {query}")
    
    # All queries failed
    return None, None

def geocode_location(description, city, state, country):
    """
    Geocode a location using the configured service.
    
    For Nominatim, this function uses build_nominatim_queries() to convert
    DOT-style descriptions into natural language queries.
    
    Args:
        description: Camera location description (e.g., "I-84 at Lloyd Blvd")
        city: City name (e.g., "Portland")
        state: State abbreviation (e.g., "OR")
        country: Country name (e.g., "USA")
    
    Returns:
        Tuple of (lat, lon) if successful, or (None, None) if not found
    """
    # Build query string in correct order
    query = f"{description}, {city}, {state}, {country}"
    
    if USE_NOMINATIM:
        # Build optimized Nominatim queries from DOT-style description
        # Create a dict to pass to build_nominatim_queries()
        camera_row = {
            'description': description,
            'city': city,
            'state': state,
            'country': country
        }
        queries = build_nominatim_queries(camera_row)
        print(f"  🔍 Geocoding (original): {query}")
        print(f"  🔍 Geocoding (optimized): {queries[0]}")
        
        # Try multiple query variations
        lat, lon = geocode_with_nominatim_multiple(queries)
    else:
        # OpenCage: use simple query format
        print(f"  🔍 Geocoding: {query}")
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
    
    # Display Nominatim compliance notice if using Nominatim
    if USE_NOMINATIM:
        print("ℹ️  Using Nominatim (OpenStreetMap) geocoding service")
        print("   This script is compliant with Nominatim Usage Policy")
        print(f"   User-Agent: {NOMINATIM_USER_AGENT}")
        print(f"   Rate limit: {API_DELAY} second(s) between requests")
        print()
    
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
        
        # Rate limiting (Nominatim Usage Policy compliance)
        # Always sleep after each geocoding request (except after the last one)
        # This ensures at least 1.0 second delay between Nominatim requests
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

