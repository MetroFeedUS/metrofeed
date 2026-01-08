# Route Overlay Troubleshooting Checklist

## Current Implementation Status

### ✅ Script Loading Order (lines 1050-1059)
1. MapLibre GL JS - ✅ Loaded
2. mastermap.js - ✅ Loaded (contains masterRoutes)
3. metroFeedMap.js - ✅ Loaded
4. cameraIcon.js - ✅ Loaded
5. **routeOverlay.js - ✅ Loaded (exposes window.attachRouteToMap)**
6. trafficCamerasOverlay.js - ✅ Loaded
7. Main script starts - ✅

### ✅ Function Definitions
- `window.attachRouteToMap` - Defined in routeOverlay.js line 308
- `window.showRouteOverlay` - Defined in portlandindex.html line 3699
- `window.activeRouteOverlays` - Initialized line 3689

### ✅ Button Integration
- OTP bus popup button - Line 2597
- All buses popup button - Line 2659
- Both check for function existence before calling

## Potential Issues to Check

### Issue 1: Script Loading Timing
**Check:** Open browser console and type:
```javascript
typeof window.attachRouteToMap
typeof window.showRouteOverlay
typeof masterRoutes
```
**Expected:** All should return "function" or "object", not "undefined"

### Issue 2: Button Click Not Firing
**Check:** Click a bus marker, then click "Show Route" button
**Expected:** Console should show `[showRouteOverlay] Looking for route: ...`

### Issue 3: Route Data Not Found
**Check:** Console should show available routes if route not found
**Expected:** First 10 routes from masterRoutes

### Issue 4: Map Not Ready
**Check:** Is map loaded when showRouteOverlay is called?
**Expected:** map.loaded() should return true

### Issue 5: Route Data Structure
**Check:** Does routeData have shape[] and stops[] arrays?
**Expected:** Both should be arrays with length > 0

## Debug Steps

1. **Test in Console:**
   ```javascript
   // Test if functions exist
   console.log('attachRouteToMap:', typeof window.attachRouteToMap);
   console.log('showRouteOverlay:', typeof window.showRouteOverlay);
   console.log('masterRoutes:', typeof masterRoutes, masterRoutes?.length);
   
   // Test with a known route
   if (typeof showRouteOverlay === 'function') {
     showRouteOverlay("15", 0);
   }
   ```

2. **Check Button HTML:**
   - Right-click "Show Route" button → Inspect
   - Check onclick attribute is present
   - Check routeNumber and direction values are correct

3. **Check Console Errors:**
   - Look for any red error messages
   - Check for "not available" or "not found" messages

4. **Verify Route Data:**
   ```javascript
   // In console, find a route
   const testRoute = masterRoutes.find(r => r.route_number === "15" && r.direction_id === 0);
   console.log('Test route:', testRoute);
   console.log('Has shape:', Array.isArray(testRoute?.shape));
   console.log('Has stops:', Array.isArray(testRoute?.stops));
   ```

