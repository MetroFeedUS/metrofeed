# MetroFeed Portland - Complete AI Context Documentation

## PROJECT OVERVIEW

**MetroFeed** is a Progressive Web App (PWA) for civic transit information, serving the Portland, Oregon area. The application provides real-time transit data, traffic information, weather, route planning, and various transit-related overlays on an interactive map.

**Business Model**: Completely FREE service, funded by advertisement revenue. No authentication, sign-in, or premium features required.

**Primary Entry Point**: `portlandindex.html` - This is the main application page (home page), though not necessarily the initial landing page.

---

## TECHNOLOGY STACK

- **Frontend Framework**: Vanilla JavaScript (no frameworks)
- **Map Library**: MapLibre GL JS v3.6.2 (self-hosted vector tiles)
- **Map Styles**: 
  - Day: `https://maps.metrofeedus.com/styles/0/style.json`
  - Night: `https://maps.metrofeedus.com/styles/1/style.json`
- **APIs Used**:
  - TriMet API (live bus tracking, alerts, route validation)
  - Open Trip Planner (OTP) - Self-hosted at `https://otp.metrofeedus.com/otp/routers/default/plan`
  - MetroFeed traffic API
  - National Weather Service
- **Data Storage**: LocalStorage, SessionStorage for user preferences
- **Translation System**: Custom `translations.js` with multi-language support

---

## KEY FILE STRUCTURE

### Core Application Files
- **`portlandindex.html`** (5,047 lines) - Main application page with embedded JavaScript
  - Contains all UI elements, modals, dropdowns, map initialization
  - Embedded JavaScript handles all application logic
  - Includes OTP integration, bus tracking, route overlays, traffic cameras, marketplace

### Shared JavaScript Modules
- **`metroFeedMap.js`** - Shared map initialization function
  - `initMetroFeedMap(containerId, options)` - Creates MapLibre GL map with day/night layers
  - Returns: `{ map, dayStyle, nightStyle }`
  - Used by both main map and editor pages

- **`routeOverlay.js`** - Shared route drawing module
  - `attachRouteToMap(map, routeId, directionId, options)` - Draws bus/rail routes on map
  - Handles route polylines, stop markers, popups with times
  - Supports live bus tracking integration
  - Returns overlay handle with `remove()` method

- **`trafficCamerasOverlay.js`** - Traffic camera overlay module
  - Loads from `data/cameras.json`
  - Manages camera markers on map
  - Handles camera feed modals
  - `TrafficCamerasOverlay.init(map)`, `TrafficCamerasOverlay.toggle()`

- **`marketplaceOverlay.js`** - Marketplace/vending machine overlay module
  - Loads from `data/marketplace.json`
  - Feature toggle: `MARKETPLACE_ENABLED` (currently `false`)
  - When disabled: Shows "coming soon" modal
  - When enabled: Shows map markers if locations exist
  - `MarketplaceOverlay.init(map)`, `MarketplaceOverlay.toggle()`

- **`cameraIcon.js`** - Shared camera icon creation function
  - `createCameraMarkerElement(size)` - Creates consistent camera marker elements
  - Uses `004-cctv-camera.svg`

- **`mastermap.js`** - Contains route shapes, stops, and schedules data
  - Used for route validation and display
  - Contains `masterRoutes` object with route data

- **`translations.js`** - Multi-language translation system
  - Supports English and Spanish (and potentially more)
  - Uses `data-translate` attributes in HTML
  - Functions: `translateText()`, `updatePageLanguage()`, `setLanguage()`
  - Cache-busting: Currently at `?v=15`

### Editor Pages
- **`TrafficCamerasEditor.html`** - Interactive editor for placing camera pins on map
  - Loads existing `data/cameras.json`
  - Allows placing/moving pins, exporting JSON
  - Uses shared `initMetroFeedMap()` and `createCameraMarkerElement()`

- **`MarketplaceEditor.html`** - Interactive editor for placing marketplace/vending machine locations
  - Loads existing `data/marketplace.json`
  - Allows adding/editing/deleting locations
  - Places pins on map, exports JSON

### Data Files
- **`data/cameras.json`** - Traffic camera locations (single source of truth)
  - Format: Array of objects with `{id, name, description, city, state, country, url, lat, lon}`
  - Managed via TrafficCamerasEditor.html

- **`data/marketplace.json`** - Marketplace/vending machine locations
  - Format: Array of objects with `{id, name, description, address, city, state, country, lat, lon}`
  - Currently empty array `[]`
  - Managed via MarketplaceEditor.html

### Supporting Pages
- **`resources.html`** - ADA and Official Resources page
  - Lists official links (TARC, Paratransit, NWS, Louisville.gov, TRIMARC)
  - Includes disclaimer about MetroFeed being independent
  - Replaces old `chat.html`

- **`portlandweather.html`** - Weather information page
- **`freecitychanger.html`** - City selection page
- **`alerts.html`** - Service alerts page (legacy, now replaced by marketplace concept)

### Configuration
- **`manifest.json`** - PWA manifest
  - `background_color: "#000000"` (black splash screen)
  - `theme_color: "#1E90FF"` (brand blue)
  - Icon: `metrofeedsimplelogo.png`

---

## BRANDING & DESIGN

### Color Scheme
- **Primary Brand Color**: `#1E90FF` (Dodger Blue) - Previously `#4dd0e1` (cyan), then `#275BF5` (darker blue)
- **Accent Color**: `#FF6B35` (Orange) - Used for active states, highlights
- **Background**: `#0d0d0d` (dark gray/black)
- **Text**: `#cccccc` (light gray), `#fff` (white)

### SVG Icons
All dropdown menu SVGs are **white** (`fill="#ffffff"` or `filter: brightness(0) invert(1)`):
- `002-bus.svg` - Bus Routes
- `001-train-station.svg` - Rail Routes
- `003-warning.svg` - Traffic Overlay
- `004-cctv-camera.svg` - Traffic Cameras (white in button, black/white on map based on theme)
- `005-weather-radar.svg` - Weather
- `information-button.svg` - ADA and Official Resources
- `store.svg` - Marketplace (white in dropdown, orange on map)
- `007-move.svg` - Change City
- `megaphone.svg` - Advertise
- `youtube.svg` - YouTube (red button)
- `marker.svg` - Map selection buttons
- `010-ticket.svg` - Purchase Ticket
- `008-night.svg` - Day/Night toggle
- `global.svg` - Language
- `005-list.svg` - Menu

### Special Button Styling
- **YouTube Button**: Red (`#ff0000` or similar) with red hover glow
- **Advertise Button**: Gray/Silver with gray hover glow
- **Active Overlay Buttons**: Orange back glow (`box-shadow: 0 0 12px #FF6B35`)

---

## UI COMPONENTS & FEATURES

### Dropdown Menu (Top-right, hamburger menu)
**Order** (top to bottom):
1. YouTube (red) - Links to `https://www.youtube.com/@MetroFeedLouisville`
2. **DIVIDER**
3. Bus Routes - Opens modal with route list
4. Rail Routes - Opens modal with route list
5. Traffic Overlay - Toggles MetroFeed traffic layer
6. Traffic Cameras - Toggles camera markers overlay
7. Weather - Links to weather page
8. ADA and Official Resources - Opens `resources.html` in new window
9. Marketplace - Toggles marketplace overlay (or shows coming soon modal)
10. Change City - Links to city changer page
11. **DIVIDER**
12. Advertise (gray) - Links to `advertise.html`

**Behavior**:
- Does NOT auto-close when buttons are clicked
- Active buttons (Traffic, Traffic Cameras, AI/Resources) show orange glow
- Tooltips appear once per session on first open (stored in `sessionStorage`)
- Tooltips show in descending order

### Map Features
- **Day/Night Toggle**: Top-right button, switches between day and night map styles
- **Theme Persistence**: Stored in `localStorage` as `isNightMode`
- **Map Bounds**: Restricted to Portland area
- **Default Zoom**: `10.5` (split between previous `13` and min zoom `8`)
- **CRS**: Standard Web Mercator

### OTP (Open Trip Planner) Integration
- **Location Selection**: Two input fields (Start, Destination)
- **Map Selection Buttons**: Right side of inputs, use `marker.svg` icon
- **Tooltips**: Appear when input fields are focused (mobile-friendly)
- **Direction Logic**: Complex matching system using `headsign` and stop names
  - Each leg (first and second) uses independent direction calculation
  - Direction stored in `legColorMapping[legKey].direction`
  - Reused for bus tracking to ensure consistency
- **Route Display**: Shows route polylines, stop markers, and live buses
- **Multi-leg Support**: Handles trips with transfers (e.g., Bus Route 77 → Bus Route 12)

### Bus Routes Overlay
- **Modal**: Opens from dropdown "Bus Routes" button
- **Features**: Search bar, expandable route list, favorite stars
- **Favorites**: Max 3 routes, stored in `localStorage`
- **Route Selection**: Calls `window.showRouteOverlay(routeId, directionId)`
- **Route Info Panel**: 
  - Appears when route is displayed
  - Can collapse to right side as orange circle with route number
  - Collapsed circles stack vertically starting at 250px from top
  - Circles are 40px (20% smaller than original 50px)
  - Shows parent route number (e.g., "4", "12") not directional
  - Clickable to expand
  - "Locked" in position when multiple routes are minimized

### Rail Routes Overlay
- **Modal**: Opens from dropdown "Rail Routes" button
- **Routes**: MAX Red, Blue, Yellow, Green, Orange lines, WES Commuter Rail
- **Same functionality as bus routes**: Search, favorites, route overlay

### Traffic Cameras Overlay
- **Toggle**: From dropdown "Traffic Cameras" button
- **Data Source**: `data/cameras.json`
- **Markers**: Camera icons on map
- **Click Behavior**: Opens modal with live camera feed
- **Icon Colors**: 
  - Button: White
  - Map (dark mode): White
  - Map (light mode): Black

### Marketplace Overlay
- **Toggle**: From dropdown "Marketplace" button
- **Feature Flag**: `MARKETPLACE_ENABLED` in `marketplaceOverlay.js` (currently `false`)
- **When Disabled**: Shows "coming soon" modal with placeholder text
- **When Enabled**: Shows orange store icons on map if locations exist
- **Data Source**: `data/marketplace.json`
- **Icon Colors**:
  - Button: White
  - Map: Orange (`#FF6B35`)

### Favorites Bar (Bottom of screen)
- **Slots**: 3 favorite routes (reduced from 4)
- **Display**: Blue numbers with white outline/border
- **Font Size**: `0.8625rem` (15% larger than base)
- **Collapsible**: Chevron in right corner, collapses to just "favorites" text
- **State**: Stored in `localStorage`

### Sponsor Box (Bottom-left)
- **Size**: 90px × 90px (square)
- **Image**: `sponsor.png`
- **Position**: 10px from left, 40px from bottom (top of footer)
- **Styling**: Dark background, blue border, matches favorites bar height

### Sponsor Modal
- **Timing**: Appears 3 seconds after page load
- **Frequency**: Once per day (resets at 1am, not every 24 hours)
- **Storage**: `localStorage` key `sponsorModalLastShown`
- **Content**: Thank-you message, sponsor PNG placeholder
- **Image**: `sponsor-ad-placeholder.png`
- **Centered**: Both modal and image are centered

### Route Info Panel (When route overlay is active)
- **Initial State**: Centered on screen, smaller modal
- **Collapse**: Slides to right side, becomes orange circle
- **Close Button**: Removes route from map
- **Content**: Route title, link to full route page

---

## DATA FLOW & ARCHITECTURE

### Route Data
1. **Source**: `mastermap.js` contains `masterRoutes` object
2. **Route Pages**: Individual HTML pages in `pythonbusroutes/` directory (e.g., `route-15-dir0.html`)
3. **Overlay**: `routeOverlay.js` draws routes on main map
4. **Live Buses**: TriMet API integration, updates every 15 seconds

### Camera Data
1. **Source**: `data/cameras.json`
2. **Editor**: `TrafficCamerasEditor.html` for placing pins
3. **Workflow**: 
   - Edit camera list in editor
   - Place pins on map
   - Export JSON
   - Paste into `data/cameras.json`
   - Deploy

### Marketplace Data
1. **Source**: `data/marketplace.json`
2. **Editor**: `MarketplaceEditor.html` for managing locations
3. **Workflow**: Same as cameras

### OTP Direction Matching
**Critical Logic** (lines ~3199-3391 in portlandindex.html):
- Matches OTP route data to TriMet route directions
- Uses `headsign` and stop names for matching
- Calculates direction (0 or 1) for each leg independently
- Stores in `legColorMapping[legKey].direction`
- **Reused** for bus tracking (lines ~3455+) - does NOT recalculate

---

## CONFIGURATION & SETTINGS

### City Configuration (CITY_CONFIG object)
```javascript
{
  cityName: "Portland",
  state: "OR",
  timezone: "America/Los_Angeles",
  apiKey: "2C4447D4A42083BCD84DE3B8E",
  otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan",
  busApi: "https://developer.trimet.org/ws/v2/vehicles",
  trafficApi: null,
  defaultCenter: [-122.6784, 45.5152],
  defaultZoom: 10.5,
  bounds: { west: -123.0, east: -122.4, south: 45.4, north: 45.65 }
}
```

### Feature Toggles
- **Marketplace**: `MARKETPLACE_ENABLED` in `marketplaceOverlay.js` (line ~25)

### Storage Keys
- `dropdownTooltipsShown` - SessionStorage (tooltips shown this session)
- `mapSelectTooltipsShown` - SessionStorage (OTP map selection tooltips)
- `isNightMode` - LocalStorage (map theme)
- `favoritesBarCollapsed` - LocalStorage (favorites bar state)
- `favoriteRoutes` - LocalStorage (array of favorite route objects)
- `sponsorModalLastShown` - LocalStorage (date string for sponsor modal)
- `hasActiveAlerts` - LocalStorage (alerts page state)

---

## KNOWN ISSUES & TROUBLESHOOTING

### Footer Translation Caching
- **Issue**: Footer text ("Terms", "Privacy") sometimes reverts to old text
- **Solution**: 
  - Cache-busting in `translations.js` (`?v=15`)
  - Safeguard in `updatePageLanguage()` forces short versions
  - All HTML files loading translations.js must use same version

### Route Overlay Not Showing
- **Check**: `window.showRouteOverlay` function exists
- **Check**: `window.activeRouteOverlays` is initialized
- **Check**: Route exists in `masterRoutes` object
- **Debug**: Extensive console logging in `showRouteOverlay` function

### Camera Markers Not Visible
- **Check**: `data/cameras.json` exists and is valid JSON
- **Check**: Map theme (dark mode = white icons, light mode = black icons)
- **Check**: `TrafficCamerasOverlay.init(map)` was called

### Marketplace Not Working
- **Check**: `MARKETPLACE_ENABLED` is set to `true` in `marketplaceOverlay.js`
- **Check**: `data/marketplace.json` exists and has locations
- **Check**: Modal appears if feature is disabled (expected behavior)

### Tooltips Not Showing
- **Check**: `sessionStorage.getItem('dropdownTooltipsShown')` - clears on new session
- **Check**: Selector matches button ID/class exactly
- **Check**: Button exists in DOM when tooltip function runs

### Orange Glow Not Appearing
- **Check**: `updateDropdownButtonStates()` is called after toggle
- **Check**: For async toggles (cameras, marketplace), await the toggle before updating states
- **Check**: `.dropdown a.active` CSS class is defined

---

## DEVELOPMENT WORKFLOW

### Adding New Overlay Feature
1. Create overlay module (e.g., `newOverlay.js`)
2. Create editor page (e.g., `NewEditor.html`) if needed
3. Create data file (e.g., `data/newdata.json`)
4. Add script tag to `portlandindex.html`
5. Initialize in `DOMContentLoaded` listener
6. Add dropdown button with toggle function
7. Update `updateDropdownButtonStates()` if needed
8. Add tooltip to `tooltipData` array

### Updating Route Data
- Routes are in `mastermap.js` - `masterRoutes` object
- Individual route pages in `pythonbusroutes/` directory
- Route overlay uses shared `routeOverlay.js` module

### Updating Camera Locations
1. Open `TrafficCamerasEditor.html`
2. Select camera from dropdown
3. Click "Place Pin"
4. Click on map
5. Export JSON
6. Copy to `data/cameras.json`
7. Deploy

### Updating Marketplace Locations
1. Open `MarketplaceEditor.html`
2. Add new location or select existing
3. Fill in name, description, address
4. Click "Place Pin"
5. Click on map
6. Export JSON
7. Copy to `data/marketplace.json`
8. Deploy

### Enabling Marketplace Feature
1. Open `marketplaceOverlay.js`
2. Change `MARKETPLACE_ENABLED` from `false` to `true` (line ~25)
3. Ensure `data/marketplace.json` has locations
4. Deploy

---

## RECENT MAJOR CHANGES

1. **Authentication Removal**: All sign-in/sign-up, premium features, account buttons removed
2. **Brand Color Change**: Cyan (`#4dd0e1`) → Dark Blue (`#275BF5`) → Dodger Blue (`#1E90FF`)
3. **Dropdown Reordering**: Menu items reordered, YouTube and Advertise buttons added
4. **Resources Page**: Replaced `chat.html` with `resources.html` (ADA and Official Resources)
5. **Marketplace Feature**: New overlay system for vending machine locations (currently disabled)
6. **Route Overlay System**: Extracted shared route drawing logic into `routeOverlay.js`
7. **Traffic Cameras Overlay**: Moved from hardcoded to JSON-based system with editor
8. **Favorites System**: Added favorite routes (max 3) with stars in route modals
9. **Sponsor Modal**: Added daily sponsor appreciation modal
10. **Collapsible Favorites Bar**: Added chevron toggle for favorites bar
11. **Route Info Panel**: Redesigned collapsed state as orange circles
12. **Manifest Splash Screen**: Changed background to pure black (`#000000`)

---

## CODE PATTERNS & CONVENTIONS

### Module Pattern
- Overlay modules use IIFE pattern: `const ModuleName = (function() { ... })();`
- Public API returned at end: `return { init, toggle, isActive, ... };`
- Private variables at top of module

### Map Initialization
- Always use `initMetroFeedMap()` from `metroFeedMap.js`
- Wait for `map.on('load')` before adding layers/markers
- Store map instance globally or in module scope

### Event Handling
- Use `event.preventDefault()` for dropdown buttons that don't navigate
- Use `event.stopPropagation()` when needed to prevent bubbling
- Async functions should `await` overlays before updating UI states

### Styling
- Inline styles for dynamic elements
- CSS classes for static/reusable styles
- Use MetroFeed blue (`#1E90FF`) for primary actions
- Use MetroFeed orange (`#FF6B35`) for active states, accents

### Console Logging
- Prefix logs with module name: `[ModuleName] Message`
- Use emojis for status: ✅ success, ⚠️ warning, ❌ error
- Extensive logging in `showRouteOverlay` for debugging

---

## IMPORTANT NOTES

- **No Framework Dependencies**: Pure vanilla JavaScript, no React/Vue/Angular
- **Self-Hosted Maps**: Map tiles served from `maps.metrofeedus.com`
- **Self-Hosted OTP**: Trip planner at `otp.metrofeedus.com`
- **Portland-Specific**: Currently configured for Portland, OR, but structure supports multi-city
- **Mobile-First**: Tooltips appear on focus/click, not just hover
- **PWA**: Installable as Progressive Web App
- **Free Service**: No paywalls, no authentication required
- **Ad-Supported**: Revenue from sponsor placements

---

## QUICK REFERENCE

### Key Functions
- `initMetroFeedMap(containerId, options)` - Initialize map
- `attachRouteToMap(map, routeId, directionId, options)` - Draw route overlay
- `TrafficCamerasOverlay.toggle()` - Toggle cameras
- `MarketplaceOverlay.toggle()` - Toggle marketplace
- `showRouteOverlay(routeId, directionId)` - Show route on main map
- `updateDropdownButtonStates()` - Update active button glows
- `showDropdownTooltips()` - Show tooltips on first dropdown open

### Key Selectors
- `#dropdownMarketplaceBtn` - Marketplace button
- `#dropdownCamerasBtn` - Traffic cameras button
- `#dropdownTrafficBtn` - Traffic overlay button
- `#dropdownAiChatBtn` - ADA and Official Resources button
- `#dropdownBusesBtn` - Bus routes button
- `#dropdownRailBtn` - Rail routes button

### Key Files to Edit
- `portlandindex.html` - Main application (5,047 lines)
- `marketplaceOverlay.js` - Marketplace feature toggle
- `data/cameras.json` - Camera locations
- `data/marketplace.json` - Marketplace locations
- `translations.js` - Translation strings
- `manifest.json` - PWA configuration

---

**Last Updated**: Based on conversation history up to marketplace feature implementation
**Version**: MetroFeed Portland - Current Production State

