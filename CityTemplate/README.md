# MetroFeed City Template

This is a template version of MetroFeed that can be used to create new city instances. All city-specific data is stored in `city-config.js`, making it easy to scale to new cities.

## How It Works

1. **Configuration-Driven**: All city-specific data (APIs, coordinates, bounds, file paths) is stored in `city-config.js`
2. **Auto-Detection**: The template automatically detects which city it's being used for based on the folder path
3. **Template File**: `home.html` is generic and uses the config file for all city-specific values

## Adding a New City

### Step 1: Add City Config
Edit `city-config.js` and add a new entry to the `CITIES` object:

```javascript
const CITIES = {
  // ... existing cities ...
  
  yourcity: {
    cityName: "Your City",
    state: "XX",
    timezone: "America/Your_Timezone",
    apiKey: "YOUR_API_KEY",
    otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan",
    busApi: "YOUR_BUS_API_URL",
    trafficApi: "https://api.tomtom.com/traffic/map/4/tile/flow/relative",
    tomtomKey: "YOUR_TOMTOM_KEY",
    defaultCenter: [-longitude, latitude], // [lon, lat]
    defaultZoom: 10.5,
    bounds: {
      north: 45.80,
      south: 45.20,
      east: -122.15,
      west: -123.35
    },
    mastermapFile: "mastermap.js", // Always "mastermap.js" (no city-specific naming)
    logoFile: "Sitelogo.png",
    busApiType: "trimet", // or "tarc-gtfs-rt" or "custom"
    gtfsRtUrl: null // if using GTFS-RT
  }
};
```

### Step 2: Create City Folder
1. Copy the entire `CityTemplate` folder
2. Rename it to your city name (e.g., `YourCity`)
3. Update the folder name to match the key in `city-config.js` (lowercase)

### Step 3: Add City-Specific Files
- Create `mastermap.js` with your route data (always named `mastermap.js`, no city-specific naming)
- Add any city-specific assets (logos, etc.)
- Update route files in `pythonbusroutes/` folder

### Step 4: Update Index.html
Add your city to the dropdown in `Index.html`:
```html
<option value="YourCity/home.html">Your City, XX</option>
```

## Configuration Options

### Required Fields
- `cityName`: Display name of the city
- `state`: State abbreviation
- `timezone`: IANA timezone string
- `defaultCenter`: [longitude, latitude] for map center
- `bounds`: North, south, east, west coordinates
- `mastermapFile`: Always set to `"mastermap.js"` (no city-specific naming)

### API Configuration
- `apiKey`: Your transit API key (if needed)
- `busApi`: URL for bus/vehicle data
- `busApiType`: Type of API ("trimet", "tarc-gtfs-rt", or "custom")
- `gtfsRtUrl`: GTFS-RT endpoint (if using GTFS-RT)
- `otpApi`: OpenTripPlanner API endpoint
- `trafficApi`: Traffic data API
- `tomtomKey`: TomTom API key

## File Structure

```
CityTemplate/
├── city-config.js          # All city configurations
├── home.html               # Main template file (generic)
├── mastermap.js            # Route data (always named mastermap.js, city-specific data inside)
├── metroFeedMap.js         # Shared map initialization
├── routeOverlay.js         # Shared route overlay
├── pythonbusroutes/        # Route detail pages
└── ... (other shared files)
```

## Notes

- **Portland folder is untouched** - This template is a separate copy
- All city-specific hardcoded values have been replaced with config lookups
- Function names use generic terms (e.g., `getCityTime()` instead of `getPortlandTime()`)
- Legacy function names are aliased for backward compatibility

## Testing

1. Copy `CityTemplate` to a test city folder
2. Add test config to `city-config.js`
3. Open `home.html` in that folder
4. The template should auto-detect the city and load the correct config

