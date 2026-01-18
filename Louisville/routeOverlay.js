/**
 * MetroFeed Route Overlay Module (clean version)
 *
 * Shared route drawing logic for:
 *  - Individual route HTML pages (route-XXX-dirY.html)
 *  - Main Portland map (bus overlay on portlandindex.html)
 *
 * USAGE EXAMPLES
 * --------------
 * // On a route page (small embedded map)
 * const routeOverlay = attachRouteToMap(map, "15", 0, {
 *   mode: "singleRoutePage",
 *   routeData: routeDataFromThisPage,
 *   routePageUrl: "pythonbusroutes/route-15-dir0.html"
 * });
 *
 * // On the main city map (overlay)
 * const routeOverlay = attachRouteToMap(mainMap, "15", 0, {
 *   mode: "mainOverlay",
 *   routeData: someRouteDataObject,
 *   routePageUrl: "pythonbusroutes/route-15-dir0.html",
 *   fitBounds: false
 * });
 *
 * routeOverlay.remove(); // cleans up layers, markers, panel
 */

"use strict";


/**
 * Attach a route overlay to a MapLibre map
 *
 * @param {maplibregl.Map} map              - MapLibre GL JS map instance
 * @param {string|number}  routeId          - Route ID / number (for labels only)
 * @param {number}         directionId      - Direction ID (0 or 1, for labels only)
 * @param {Object}         options
 * @param {Object}         options.routeData   - REQUIRED: { shape: [[lat,lon]...], stops: [...] }
 * @param {string}         options.mode        - "singleRoutePage" | "mainOverlay" (default: "mainOverlay")
 * @param {string}         options.routePageUrl- Optional: URL to full route page
 * @param {string}         options.routeColor  - Optional: line color (default MetroFeed blue)
 * @param {boolean}        options.fitBounds   - Optional: fit map to route (default: true for singleRoutePage)
 * @param {string}         options.apiKey      - Optional: TriMet API key for bus tracking
 * @param {boolean}        options.trackBuses  - Optional: enable bus tracking (default: true for mainOverlay)
 *
 * @returns {{ remove: function }} overlay handle
 */
function attachRouteToMap(map, routeId, directionId, options) {
  options = options || {};

  const mode        = options.mode || "mainOverlay";
  const routeColor  = options.routeColor || "#0071CE"; // MetroFeed blue-ish
  const fitBounds   =
    options.fitBounds !== undefined
      ? options.fitBounds
      : mode === "singleRoutePage";
  const trackBuses  = options.trackBuses !== undefined ? options.trackBuses : (mode === "mainOverlay");
  const apiKey      = options.apiKey || null;

  const routeData = options.routeData;

  // ==== Basic validation =====================================================
  if (!map || typeof map.addSource !== "function") {
    console.error("[attachRouteToMap] Invalid MapLibre map instance.");
    return { remove: function () {} };
  }

  if (!routeData || !Array.isArray(routeData.shape) || !Array.isArray(routeData.stops)) {
    console.error("[attachRouteToMap] routeData with shape[] and stops[] is REQUIRED.", {
      routeId,
      directionId,
      routeData
    });
    return { remove: function () {} };
  }

  const shape      = routeData.shape; // [[lat,lon], ...]
  const stops      = routeData.stops; // [{lat,lon,times,name,stop_id}, ...]
  const routeTitle = routeData.route_title || `Route ${routeId}`;

  // ==== Tracking created objects for cleanup =================================
  const overlayElements = {
    sources:  [],
    layers:   [],
    markers:  [],
    controls: [],
    intervals: [] // For bus tracking intervals
  };

  // ==== Internal: build & attach =================================================
  const addRouteToMap = () => {
    // ---------- Route line ----------
    const routeSourceId = `route-line-${routeId}-${directionId}`;
    const routeLayerId  = `route-layer-${routeId}-${directionId}`;

    // Guard against duplicate IDs
    if (map.getLayer(routeLayerId)) {
      map.removeLayer(routeLayerId);
    }
    if (map.getSource(routeSourceId)) {
      map.removeSource(routeSourceId);
    }

    map.addSource(routeSourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: shape.map((coord) => [coord[1], coord[0]]) // [lat,lon] -> [lon,lat]
        }
      }
    });
    overlayElements.sources.push(routeSourceId);

    map.addLayer({
      id: routeLayerId,
      type: "line",
      source: routeSourceId,
      paint: {
        "line-color": routeColor,
        "line-width": 4,
        "line-opacity": 0.8
      }
    });
    overlayElements.layers.push(routeLayerId);

    // ---------- Fit bounds (if desired) ----------
    if (fitBounds && shape.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      shape.forEach((coord) => bounds.extend([coord[1], coord[0]]));
      map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
    }

    // ---------- Stops + popups ----------
    // Get timezone from route metadata or fallback
    const agencyTimezone = (routeData.meta && routeData.meta.agency_timezone) 
      ? routeData.meta.agency_timezone 
      : "America/New_York"; // Default fallback
    
    // Get current time in the correct timezone (proper timezone-aware calculation)
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: agencyTimezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false
    });
    const parts = timeFormatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === "hour").value, 10);
    const minute = parseInt(parts.find(p => p.type === "minute").value, 10);
    const nowMins = hour * 60 + minute;
    
    // Debug: log current time calculation
    console.log(`[routeOverlay] Current time in ${agencyTimezone}: ${hour}:${String(minute).padStart(2, '0')} (${nowMins} minutes)`);
    
    // Get current day in the timezone
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: agencyTimezone,
      weekday: "long"
    });
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    
    // Determine which schedule bucket to use
    let scheduleBucket = "weekday";
    if (currentDay === 0) {
      scheduleBucket = "sunday";
    } else if (currentDay === 6) {
      scheduleBucket = "saturday";
    } else {
      scheduleBucket = "weekday";
    }
    
    // Get weeklyTimes from routeData (new format) or fallback to legacy stop.times
    const weeklyTimes = routeData.weeklyTimes || {};

    stops.forEach((stop) => {
      const lat = stop.lat;
      const lon = stop.lon;

      if (typeof lat !== "number" || typeof lon !== "number") return;

      // Get times for this stop from weeklyTimes
      const stopId = String(stop.stop_id || "");
      let timesArray = [];
      
      // Try to get from weeklyTimes first (new format)
      if (weeklyTimes[scheduleBucket] && weeklyTimes[scheduleBucket][stopId]) {
        timesArray = weeklyTimes[scheduleBucket][stopId];
      } else if (weeklyTimes.weekday && weeklyTimes.weekday[stopId]) {
        // Fallback to weekday if current day bucket doesn't exist
        timesArray = weeklyTimes.weekday[stopId];
      } else if (Array.isArray(stop.times)) {
        // Legacy fallback to stop.times
        timesArray = stop.times;
      }

      // Process times: convert to minutes and find next upcoming time
      const allTimes = [];
      timesArray.forEach((timeStrRaw) => {
        let timeStr = String(timeStrRaw).trim();
        if (!timeStr) return;
        
        // Parse HH:MM:SS or HH:MM format
        const parts = timeStr.split(":");
        if (parts.length < 2) return;
        
        let h = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10);
        
        if (isNaN(h) || isNaN(m)) return;
        
        // Handle times > 24:00:00 (next day)
        if (h >= 24) {
          h = h - 24;
        }
        
        const schedMins = h * 60 + m;
        
        // Handle past times: if time is in the past (even by a minute), treat it as tomorrow
        // This ensures we always show future times
        let adjustedMins = schedMins;
        if (schedMins < nowMins) {
          // Time is in the past, add 1440 minutes (24 hours) to make it "tomorrow"
          adjustedMins = schedMins + 1440;
        }
        
        // Convert to 12-hour display format
        let displayH = h;
        const ampm = displayH >= 12 ? "PM" : "AM";
        if (displayH > 12) displayH -= 12;
        if (displayH === 0) displayH = 12;
        const mStr = String(m).padStart(2, "0");
        const displayTime = `${displayH}:${mStr} ${ampm}`;
        
        allTimes.push({
          displayTime: displayTime,
          schedMins: adjustedMins,
          originalMins: schedMins
        });
      });

      // Sort all times by adjusted minutes (schedMins contains adjusted value)
      allTimes.sort((a, b) => a.schedMins - b.schedMins);
      
      // Find the next upcoming time
      // schedMins >= 1440 means it was adjusted (tomorrow), < 1440 means it's still today
      let nextTimeIndex = -1;
      
      // First pass: look for times today that are in the future (not adjusted, and >= nowMins)
      for (let i = 0; i < allTimes.length; i++) {
        const timeData = allTimes[i];
        // If this time was NOT adjusted (schedMins < 1440) and it's in the future
        if (timeData.schedMins < 1440 && timeData.originalMins >= nowMins) {
          nextTimeIndex = i;
          break;
        }
      }
      
      // Second pass: if no today time found, use first tomorrow time (adjusted time)
      if (nextTimeIndex === -1) {
        for (let i = 0; i < allTimes.length; i++) {
          const timeData = allTimes[i];
          // If this is a tomorrow time (was adjusted, so schedMins >= 1440)
          if (timeData.schedMins >= 1440) {
            nextTimeIndex = i;
            break;
          }
        }
      }
      
      // Fallback: use first time if nothing found
      if (nextTimeIndex === -1 && allTimes.length > 0) {
        nextTimeIndex = 0;
      }
      
      // Debug: log what we found
      if (allTimes.length > 0 && nextTimeIndex >= 0) {
        const nextTime = allTimes[nextTimeIndex];
        console.log(`[routeOverlay] Stop ${stopId}: Found next time at index ${nextTimeIndex}: ${nextTime.displayTime} (original: ${nextTime.originalMins}min, adjusted: ${nextTime.schedMins}min, now: ${nowMins}min)`);
      }
      
      // Build display: 2 before, next (highlighted), 5 after (8 total)
      const highlightedTimes = [];
      const timesToShow = 8;
      const timesBefore = 2;
      const timesAfter = 5;
      
      if (nextTimeIndex >= 0) {
        // Get times before next
        const beforeStart = Math.max(0, nextTimeIndex - timesBefore);
        const beforeTimes = allTimes.slice(beforeStart, nextTimeIndex);
        
        // Add before times
        beforeTimes.forEach(timeData => {
          highlightedTimes.push(timeData.displayTime);
        });
        
        // Add next time (highlighted)
        highlightedTimes.push(
          `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${allTimes[nextTimeIndex].displayTime}</span>`
        );
        
        // Add after times (up to 5)
        const afterEnd = Math.min(allTimes.length, nextTimeIndex + 1 + timesAfter);
        const afterTimes = allTimes.slice(nextTimeIndex + 1, afterEnd);
        
        afterTimes.forEach(timeData => {
          highlightedTimes.push(timeData.displayTime);
        });
        
        // If we don't have enough times, wrap around to beginning of array
        if (highlightedTimes.length < timesToShow && allTimes.length > 0) {
          const needed = timesToShow - highlightedTimes.length;
          for (let i = 0; i < needed && i < allTimes.length; i++) {
            highlightedTimes.push(allTimes[i].displayTime);
          }
        }
      } else if (allTimes.length > 0) {
        // No next time found, just show first 8 times
        allTimes.slice(0, timesToShow).forEach((timeData, index) => {
          if (index === 0) {
            highlightedTimes.push(
              `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${timeData.displayTime}</span>`
            );
          } else {
            highlightedTimes.push(timeData.displayTime);
          }
        });
      }

      // Stop marker element
      const stopElement = document.createElement("div");
      stopElement.style.width          = "12px";
      stopElement.style.height         = "12px";
      stopElement.style.backgroundColor= "#1E90FF";
      stopElement.style.borderRadius   = "50%";
      stopElement.style.border         = "2px solid #fff";
      stopElement.style.opacity        = "0.9";
      stopElement.style.cursor         = "pointer";

      const stopMarker = new maplibregl.Marker({ element: stopElement })
        .setLngLat([lon, lat]);

      // Popup content
      const popupContent = document.createElement("div");
      popupContent.innerHTML = `
        <div style="border:1px solid #1E90FF;border-radius:8px;padding:10px;background:#222;color:#fff;min-width:200px;">
          <strong style="color:#1E90FF;">${stop.name || `Stop ${stop.stop_id}`}</strong>
          ${
            highlightedTimes.length
              ? `
            <hr style="border:none;border-top:1px solid #1E90FF;margin:6px 0;">
            ${highlightedTimes.join("<br>")}
          `
              : ""
          }
        </div>
      `;

      const popup = new maplibregl.Popup().setDOMContent(popupContent);

      stopMarker.setPopup(popup);
      stopMarker.addTo(map);

      overlayElements.markers.push(stopMarker);
    });

    // ---------- Route info panel (mainOverlay only) ----------
    if (mode === "mainOverlay" && options.routePageUrl) {
      const panelId = `route-info-${routeId}-${directionId}`;
      const existing = document.getElementById(panelId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const routeInfoPanel = document.createElement("div");
      routeInfoPanel.id = panelId;
      routeInfoPanel.className = "route-info-panel";
      routeInfoPanel.style.cssText = `
        position:absolute;
        top:50%;
        left:50%;
        transform:translate(-50%, -50%);
        background:rgba(30,30,30,0.95);
        border:2px solid #1E90FF;
        border-radius:8px;
        padding:12px;
        color:#fff;
        z-index:1000;
        max-width:280px;
        min-width:200px;
        box-shadow:0 4px 12px rgba(0,0,0,0.5);
        transition:all 0.3s ease;
      `;
      
      // Create collapse button (starts pointing right ▶ to collapse)
      const collapseBtn = document.createElement("button");
      collapseBtn.innerHTML = "▶";
      collapseBtn.style.cssText = `
        position:absolute;
        right:32px;
        top:4px;
        background:transparent;
        color:#fff;
        border:none;
        padding:2px 6px;
        cursor:pointer;
        font-size:16px;
        z-index:1001;
        line-height:1;
      `;
      collapseBtn.onmouseover = () => collapseBtn.style.background = "rgba(255,255,255,0.2)";
      collapseBtn.onmouseout = () => collapseBtn.style.background = "transparent";
      
      let isCollapsed = false;
      
      // Make the panel clickable when collapsed to expand it
      routeInfoPanel.addEventListener('click', function(e) {
        // Check if panel is collapsed by checking the data attribute
        if (this.getAttribute('data-collapsed') === 'true') {
          // Expand when clicking anywhere on the collapsed circle
          e.stopPropagation();
          // Manually trigger the expand logic by calling collapseBtn.onclick
          // This will toggle isCollapsed and update the panel
          if (collapseBtn && typeof collapseBtn.onclick === 'function') {
            const fakeEvent = { stopPropagation: () => {}, preventDefault: () => {} };
            collapseBtn.onclick(fakeEvent);
          }
        }
      });
      
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          // Collapse to right side - circle with route number
          // Find the next available position (highest existing index + 1)
          const allPanels = Array.from(map.getContainer().querySelectorAll('.route-info-panel'));
          const collapsedPanels = allPanels.filter(panel => 
            panel.getAttribute('data-collapsed') === 'true' && panel !== routeInfoPanel
          );
          
          // Find the highest index from stored collapse-index attributes
          let maxIndex = -1;
          collapsedPanels.forEach(panel => {
            const storedIndex = panel.getAttribute('data-collapse-index');
            if (storedIndex !== null) {
              maxIndex = Math.max(maxIndex, parseInt(storedIndex, 10));
            }
          });
          
          const panelIndex = maxIndex + 1; // Next available position
          const circleSize = 40; // 20% smaller than 50px
          const circleSpacing = 10; // Space between circles
          const topOffset = 250; // Start from top to avoid overlapping with other UI elements
          const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
          
          // Mark this panel as collapsed and store its position index
          routeInfoPanel.setAttribute('data-collapsed', 'true');
          routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
          
          routeInfoPanel.style.left = `calc(100% - ${circleSize + 10}px)`; // Position from right edge with margin
          routeInfoPanel.style.top = `${verticalPosition}px`;
          routeInfoPanel.style.transform = "none"; // Remove centering transform
          routeInfoPanel.style.width = `${circleSize}px`;
          routeInfoPanel.style.height = `${circleSize}px`;
          routeInfoPanel.style.minWidth = `${circleSize}px`;
          routeInfoPanel.style.maxWidth = `${circleSize}px`;
          routeInfoPanel.style.minHeight = `${circleSize}px`;
          routeInfoPanel.style.maxHeight = `${circleSize}px`;
          routeInfoPanel.style.padding = "0";
          routeInfoPanel.style.borderRadius = "50%"; // Perfect circle
          routeInfoPanel.style.border = "3px solid #fff"; // White border
          routeInfoPanel.style.background = "#FF6B35"; // Orange background
          routeInfoPanel.style.display = "flex";
          routeInfoPanel.style.alignItems = "center";
          routeInfoPanel.style.justifyContent = "center";
          routeInfoPanel.style.cursor = "pointer"; // Make it clear it's clickable
          // Hide collapse button and close button
          collapseBtn.style.display = "none";
          closeBtn.style.display = "none";
          routeInfoPanel.querySelector(".route-info-content").style.display = "none";
          // Show collapsed route number (circle)
          const collapsedName = routeInfoPanel.querySelector(".route-name-collapsed");
          if (collapsedName) {
            collapsedName.style.display = "block";
            collapsedName.style.color = "#fff"; // White text
            collapsedName.style.fontWeight = "bold";
            collapsedName.style.fontSize = "1rem"; // Slightly smaller for 40px circle
          }
        } else {
          // Expand back to center - restore original panel styles
          routeInfoPanel.removeAttribute('data-collapsed');
          routeInfoPanel.style.left = "50%";
          routeInfoPanel.style.top = "50%";
          routeInfoPanel.style.transform = "translate(-50%, -50%)";
          routeInfoPanel.style.width = "auto";
          routeInfoPanel.style.minWidth = "200px";
          routeInfoPanel.style.maxWidth = "none";
          routeInfoPanel.style.height = "auto";
          routeInfoPanel.style.minHeight = "auto";
          routeInfoPanel.style.maxHeight = "none";
          routeInfoPanel.style.padding = "12px";
          routeInfoPanel.style.borderRadius = "8px";
          routeInfoPanel.style.background = "rgba(30,30,30,0.95)";
          routeInfoPanel.style.border = "2px solid #1E90FF";
          routeInfoPanel.style.display = "block";
          routeInfoPanel.style.cursor = "default";
          
          // Don't recalculate positions - keep other collapsed panels locked in place
          // Each panel maintains its own position when collapsed, so they don't move when others expand
          // Move collapse button back to top-right (left of close button)
          collapseBtn.style.right = "32px";
          collapseBtn.style.left = "auto";
          collapseBtn.style.top = "4px";
          collapseBtn.style.transform = "none";
          collapseBtn.style.display = "flex";
          collapseBtn.innerHTML = "▶"; // Point right to collapse
          closeBtn.style.display = "flex";
          routeInfoPanel.querySelector(".route-info-content").style.display = "block";
          // Hide collapsed route name
          const collapsedName = routeInfoPanel.querySelector(".route-name-collapsed");
          if (collapsedName) {
            collapsedName.style.display = "none";
          }
        }
      };
      
      // Create close button
      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "×";
      closeBtn.style.cssText = `
        position:absolute;
        top:4px;
        right:4px;
        background:transparent;
        color:#fff;
        border:none;
        font-size:20px;
        cursor:pointer;
        width:24px;
        height:24px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:4px;
        line-height:1;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = "rgba(255,255,255,0.2)";
      closeBtn.onmouseout = () => closeBtn.style.background = "transparent";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        // Find and remove this overlay
        if (window.activeRouteOverlays) {
          const overlayKey = `${routeId}-${directionId}`;
          if (window.activeRouteOverlays[overlayKey]) {
            window.activeRouteOverlays[overlayKey].remove();
            delete window.activeRouteOverlays[overlayKey];
          }
        }
      };
      
      // Content wrapper
      const contentDiv = document.createElement("div");
      contentDiv.className = "route-info-content";
      
      // Store routeData globally for modal access
      if (!window.routeDataCache) {
        window.routeDataCache = {};
      }
      const cacheKey = `${routeId}-${directionId}`;
      window.routeDataCache[cacheKey] = routeData;
      
      contentDiv.innerHTML = `
        <div style="margin-bottom:8px; padding-right:20px;">
          <strong style="color:#1E90FF;font-size:1em;">${routeTitle}</strong>
        </div>
        <button onclick="if(typeof showRouteScheduleModal === 'function') { const routeData = window.routeDataCache && window.routeDataCache['${cacheKey}']; if(routeData) { showRouteScheduleModal(routeData); } else { console.error('Route data not found in cache'); } } else { console.error('showRouteScheduleModal not available'); }"
           style="color:#1E90FF;background:transparent;border:1px solid #1E90FF;border-radius:6px;padding:6px 12px;font-weight:bold;cursor:pointer;display:inline-block;margin-top:8px;font-size:0.9em;transition:all 0.2s;"
           onmouseover="this.style.background='#1E90FF';this.style.color='#0d0d0d';"
           onmouseout="this.style.background='transparent';this.style.color='#1E90FF';">
          Search all stop times
        </button>
      `;
      
      // Collapsed route number (circle display)
      const collapsedName = document.createElement("div");
      collapsedName.className = "route-name-collapsed";
      // Use the parent route ID (routeId parameter) - this is the actual route number
      // For bus routes: routeId is like "15", "4", "12", etc.
      // For rail routes: routeId is like "90" (MAX Red), "100" (MAX Blue), etc.
      let routeNumber = String(routeId);
      // Extract just the numeric part if routeId has non-numeric characters
      const numericMatch = routeNumber.match(/\d+/);
      if (numericMatch) {
        routeNumber = numericMatch[0];
      }
      collapsedName.innerHTML = routeNumber;
      collapsedName.style.cssText = `
        display:none;
        position:relative;
        color:#fff;
        font-weight:bold;
        font-size:1rem;
        pointer-events:none;
        text-align:center;
        line-height:1;
        margin:0;
        padding:0;
      `;
      
      routeInfoPanel.appendChild(closeBtn);
      routeInfoPanel.appendChild(contentDiv);
      routeInfoPanel.appendChild(collapsedName);
      routeInfoPanel.appendChild(collapseBtn);

      map.getContainer().appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }

    // ---------- Bus tracking (for mainOverlay mode only) ----------
    if (trackBuses && apiKey && mode === "mainOverlay") {
      const busMarkers = {}; // Store bus markers separately
      
      async function fetchAndDisplayBuses() {
        try {
          const routeNum = String(routeId).replace(/[^0-9]/g, ''); // Extract numeric route ID
          if (!routeNum) {
            console.warn('[attachRouteToMap] Invalid route ID for bus tracking:', routeId);
            return;
          }
          
          // Get bus API configuration
          const busApiType = (options.busApiType || (typeof window !== 'undefined' && window.CITY_CONFIG && window.CITY_CONFIG.busApiType)) || 'trimet';
          let allBuses = [];
          
          if (busApiType === 'tarc-gtfs-rt') {
            // TARC GTFS-RT format
            try {
              // Try main endpoint first, fallback to alternative if available
              let gtfsRtUrl = (options.gtfsRtUrl || (typeof window !== 'undefined' && window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrl)) || 
                               (typeof window !== 'undefined' && window.CITY_CONFIG && window.CITY_CONFIG.busApi);
              const altUrl = (typeof window !== 'undefined' && window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrlAlt);
              
              if (!gtfsRtUrl) {
                console.error('[attachRouteToMap] No GTFS-RT URL configured');
                return;
              }
              
              console.log('[attachRouteToMap] Using GTFS-RT endpoint:', gtfsRtUrl);
              if (altUrl) {
                console.log('[attachRouteToMap] Alternative endpoint available:', altUrl);
              }
              
              // Try JSON format first
              let res = await fetch(gtfsRtUrl + (gtfsRtUrl.includes('?') ? '&' : '?') + 'format=json');
              let data;
              
              const contentType = res.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                data = await res.json();
              } else {
                res = await fetch(gtfsRtUrl);
                
                // Check for compression
                const contentEncoding = res.headers.get('content-encoding');
                console.log('[attachRouteToMap] 📋 Response headers:');
                console.log('  - Content-Encoding:', contentEncoding || 'none');
                console.log('  - Content-Type:', res.headers.get('content-type') || 'unknown');
                console.log('  - Content-Length:', res.headers.get('content-length') || 'unknown');
                
                let buffer = await res.arrayBuffer();
                console.log('[attachRouteToMap] 📦 Received buffer size:', buffer.byteLength, 'bytes');
                
                // Check if buffer starts with gzip magic bytes (1f 8b) - indicates compressed data
                const uint8Check = new Uint8Array(buffer);
                const isGzipCompressed = buffer.byteLength >= 2 && uint8Check[0] === 0x1f && uint8Check[1] === 0x8b;
                
                if (isGzipCompressed) {
                  console.log('[attachRouteToMap] 🔍 Detected gzip compression (magic bytes: 1f 8b)');
                  console.log('[attachRouteToMap] 🔓 Attempting to decompress...');
                  try {
                    // Use the DecompressionStream API if available (modern browsers)
                    if (typeof DecompressionStream !== 'undefined') {
                      const stream = new DecompressionStream('gzip');
                      const decompressedStream = new Response(buffer).body.pipeThrough(stream);
                      const decompressedResponse = new Response(decompressedStream);
                      buffer = await decompressedResponse.arrayBuffer();
                      console.log('[attachRouteToMap] ✅ Decompressed successfully! New size:', buffer.byteLength, 'bytes');
                    } else {
                      console.warn('[attachRouteToMap] DecompressionStream not available. Browser should have auto-decompressed.');
                      console.warn('[attachRouteToMap] If this fails, the endpoint may require manual decompression.');
                    }
                  } catch (decompressError) {
                    console.error('[attachRouteToMap] Decompression failed:', decompressError);
                    console.warn('[attachRouteToMap] Continuing with compressed buffer (will likely fail)');
                  }
                } else if (contentEncoding && (contentEncoding.includes('gzip') || contentEncoding.includes('deflate'))) {
                  console.log('[attachRouteToMap] Content-Encoding header indicates compression, but buffer does not look compressed.');
                  console.log('[attachRouteToMap] Browser likely already decompressed it automatically.');
                }
                
                try {
                  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
                  // Check if it's XML (ashx endpoints sometimes return XML)
                  if (text.trim().startsWith('<?xml') || text.trim().startsWith('<')) {
                    console.warn('[attachRouteToMap] Response appears to be XML, not GTFS-RT protobuf');
                    return;
                  }
                  // Try JSON
                  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                    data = JSON.parse(text);
                  } else {
                    throw new Error('Not JSON format');
                  }
                } catch (e) {
                  // If not JSON, it's protobuf - use manual parser instead of protobufjs
                  console.log('[attachRouteToMap] Using manual GTFS-RT parser (bypassing protobufjs)');
                  
                  try {
                    const uint8Buffer = new Uint8Array(buffer);
                    
                    // Simple manual protobuf parser for GTFS-RT VehiclePosition
                    // This extracts only the fields we need: vehicle ID, route ID, lat, lon, bearing
                    function parseVarint(buf, pos) {
                      let result = 0;
                      let shift = 0;
                      let byte;
                      do {
                        if (pos >= buf.length) throw new Error('Buffer overflow');
                        byte = buf[pos++];
                        result |= (byte & 0x7F) << shift;
                        shift += 7;
                      } while (byte & 0x80);
                      return { value: result, pos };
                    }
                    
                    function readString(buf, pos, length) {
                      const bytes = buf.slice(pos, pos + length);
                      return new TextDecoder('utf-8').decode(bytes);
                    }
                    
                    function readFloat(buf, pos) {
                      const view = new DataView(buf.buffer, buf.byteOffset + pos, 4);
                      return view.getFloat32(0, true); // little-endian
                    }
                    
                    function skipField(buf, pos, wireType) {
                      if (wireType === 0) { // varint
                        const { pos: newPos } = parseVarint(buf, pos);
                        return newPos;
                      } else if (wireType === 1) { // fixed64
                        return pos + 8;
                      } else if (wireType === 2) { // length-delimited
                        const { value: length, pos: lengthPos } = parseVarint(buf, pos);
                        return lengthPos + length;
                      } else if (wireType === 5) { // fixed32
                        return pos + 4;
                      }
                      return pos;
                    }
                    
                    // Parse FeedMessage manually
                    const entities = [];
                    let pos = 0;
                    let entityCount = 0;
                    let vehicleCount = 0;
                    
                    console.log('[attachRouteToMap] 🔍 Starting manual parse, buffer size:', uint8Buffer.length);
                    
                    // Skip header (field 1) - we don't need it
                    while (pos < uint8Buffer.length) {
                      if (pos >= uint8Buffer.length) break;
                      
                      const tag = uint8Buffer[pos++];
                      if (!tag) break;
                      
                      const fieldNum = tag >> 3;
                      const wireType = tag & 0x07;
                      
                      if (fieldNum === 1) { // FeedHeader - skip it
                        pos = skipField(uint8Buffer, pos, wireType);
                      } else if (fieldNum === 2) { // FeedEntity (repeated)
                        entityCount++;
                        console.log('[attachRouteToMap] 🔍 Found entity #' + entityCount + ' at pos', pos - 1);
                        if (wireType === 2) { // length-delimited
                          const { value: entityLength, pos: lengthPos } = parseVarint(uint8Buffer, pos);
                          const entityStart = lengthPos;
                          const entityEnd = entityStart + entityLength;
                          
                          if (entityEnd > uint8Buffer.length) break;
                          
                          // Parse entity
                          let entityPos = entityStart;
                          let entityId = null;
                          let vehicle = null;
                          
                          while (entityPos < entityEnd) {
                            const entityTag = uint8Buffer[entityPos++];
                            if (!entityTag) break;
                            
                            const entityFieldNum = entityTag >> 3;
                            const entityWireType = entityTag & 0x07;
                            
                            if (entityFieldNum === 1) { // id
                              if (entityWireType === 2) {
                                const { value: strLen, pos: strLenPos } = parseVarint(uint8Buffer, entityPos);
                                entityId = readString(uint8Buffer, strLenPos, strLen);
                                entityPos = strLenPos + strLen;
                              }
                            } else if (entityFieldNum === 4) { // vehicle (VehiclePosition)
                              vehicleCount++;
                              console.log('[attachRouteToMap] 🔍 Found vehicle field in entity #' + entityCount);
                              if (entityWireType === 2) {
                                const { value: vehicleLength, pos: vehicleLenPos } = parseVarint(uint8Buffer, entityPos);
                                const vehicleStart = vehicleLenPos;
                                const vehicleEnd = vehicleStart + vehicleLength;
                                
                                console.log('[attachRouteToMap] 🔍 VehiclePosition length:', vehicleLength, 'bytes');
                                
                                // Parse VehiclePosition
                                let vehiclePos = vehicleStart;
                                let vehicleId = null;
                                let routeId = null;
                                let lat = null;
                                let lon = null;
                                let bearing = null;
                                
                                while (vehiclePos < vehicleEnd) {
                                  const vehicleTag = uint8Buffer[vehiclePos++];
                                  if (!vehicleTag) break;
                                  
                                  const vehicleFieldNum = vehicleTag >> 3;
                                  const vehicleWireType = vehicleTag & 0x07;
                                  
                                  if (vehicleFieldNum === 1) { // trip (TripDescriptor)
                                    if (vehicleWireType === 2) {
                                      const { value: tripLength, pos: tripLenPos } = parseVarint(uint8Buffer, vehiclePos);
                                      const tripStart = tripLenPos;
                                      const tripEnd = tripStart + tripLength;
                                      
                                      // Parse TripDescriptor for route_id
                                      let tripPos = tripStart;
                                      while (tripPos < tripEnd) {
                                        const tripTag = uint8Buffer[tripPos++];
                                        if (!tripTag) break;
                                        
                                        const tripFieldNum = tripTag >> 3;
                                        const tripWireType = tripTag & 0x07;
                                        
                                        if (tripFieldNum === 2 && tripWireType === 2) { // route_id
                                          const { value: routeIdLen, pos: routeIdLenPos } = parseVarint(uint8Buffer, tripPos);
                                          routeId = readString(uint8Buffer, routeIdLenPos, routeIdLen);
                                          tripPos = routeIdLenPos + routeIdLen;
                                        } else {
                                          tripPos = skipField(uint8Buffer, tripPos, tripWireType);
                                        }
                                      }
                                      vehiclePos = tripEnd;
                                    } else {
                                      vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                                    }
                                  } else if (vehicleFieldNum === 2) { // vehicle (VehicleDescriptor)
                                    if (vehicleWireType === 2) {
                                      const { value: vehDescLength, pos: vehDescLenPos } = parseVarint(uint8Buffer, vehiclePos);
                                      const vehDescStart = vehDescLenPos;
                                      const vehDescEnd = vehDescStart + vehDescLength;
                                      
                                      // Parse VehicleDescriptor for vehicle id
                                      let vehDescPos = vehDescStart;
                                      while (vehDescPos < vehDescEnd) {
                                        const vehDescTag = uint8Buffer[vehDescPos++];
                                        if (!vehDescTag) break;
                                        
                                        const vehDescFieldNum = vehDescTag >> 3;
                                        const vehDescWireType = vehDescTag & 0x07;
                                        
                                        if (vehDescFieldNum === 1 && vehDescWireType === 2) { // id
                                          const { value: vehIdLen, pos: vehIdLenPos } = parseVarint(uint8Buffer, vehDescPos);
                                          vehicleId = readString(uint8Buffer, vehIdLenPos, vehIdLen);
                                          vehDescPos = vehIdLenPos + vehIdLen;
                                        } else {
                                          vehDescPos = skipField(uint8Buffer, vehDescPos, vehDescWireType);
                                        }
                                      }
                                      vehiclePos = vehDescEnd;
                                    } else {
                                      vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                                    }
                                  } else if (vehicleFieldNum === 3) { // position (Position)
                                    if (vehicleWireType === 2) {
                                      const { value: posLength, pos: posLenPos } = parseVarint(uint8Buffer, vehiclePos);
                                      const posStart = posLenPos;
                                      const posEnd = posStart + posLength;
                                      
                                      // Parse Position for lat/lon/bearing
                                      let posPos = posStart;
                                      while (posPos < posEnd) {
                                        const posTag = uint8Buffer[posPos++];
                                        if (!posTag) break;
                                        
                                        const posFieldNum = posTag >> 3;
                                        const posWireType = posTag & 0x07;
                                        
                                        if (posFieldNum === 1 && posWireType === 5) { // latitude (fixed32/float)
                                          lat = readFloat(uint8Buffer, posPos);
                                          posPos += 4;
                                        } else if (posFieldNum === 2 && posWireType === 5) { // longitude (fixed32/float)
                                          lon = readFloat(uint8Buffer, posPos);
                                          posPos += 4;
                                        } else if (posFieldNum === 3 && posWireType === 5) { // bearing (fixed32/float)
                                          bearing = readFloat(uint8Buffer, posPos);
                                          posPos += 4;
                                        } else {
                                          posPos = skipField(uint8Buffer, posPos, posWireType);
                                        }
                                      }
                                      vehiclePos = posEnd;
                                    } else {
                                      vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                                    }
                                  } else {
                                    vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                                  }
                                }
                                
                                console.log('[attachRouteToMap] 🔍 Extracted: vehicleId=' + vehicleId + ', routeId=' + routeId + ', lat=' + lat + ', lon=' + lon);
                                
                                if (vehicleId && lat !== null && lon !== null) {
                                  vehicle = {
                                    vehicle: {
                                      id: vehicleId
                                    },
                                    trip: routeId ? { route_id: routeId } : null,
                                    position: {
                                      latitude: lat,
                                      longitude: lon,
                                      bearing: bearing || 0
                                    }
                                  };
                                  console.log('[attachRouteToMap] ✅ Vehicle parsed successfully');
                                } else {
                                  console.warn('[attachRouteToMap] ⚠️ Vehicle missing required fields. vehicleId:', vehicleId, 'lat:', lat, 'lon:', lon);
                                }
                                
                                entityPos = vehicleEnd;
                              } else {
                                entityPos = skipField(uint8Buffer, entityPos, entityWireType);
                              }
                            } else {
                              entityPos = skipField(uint8Buffer, entityPos, entityWireType);
                            }
                          }
                          
                          if (vehicle) {
                            entities.push({
                              id: entityId || 'unknown',
                              vehicle: vehicle
                            });
                          }
                          
                          pos = entityEnd;
                        } else {
                          pos = skipField(uint8Buffer, pos, wireType);
                        }
                      } else {
                        pos = skipField(uint8Buffer, pos, wireType);
                      }
                    }
                    
                    data = { entity: entities };
                    console.log('[attachRouteToMap] ✅ Manual parser: found', entityCount, 'entities,', vehicleCount, 'vehicle fields, extracted', entities.length, 'complete vehicles');
                  } catch (parseError) {
                    console.error('[attachRouteToMap] Manual parser error:', parseError);
                    console.error('[attachRouteToMap] Stack:', parseError.stack);
                    return;
                  }
                }
              }
              
              // Parse GTFS-RT format
              if (data.entity && Array.isArray(data.entity)) {
                data.entity.forEach(entity => {
                  if (entity.vehicle && entity.vehicle.position && entity.vehicle.trip) {
                    const vehicle = entity.vehicle;
                    const trip = vehicle.trip;
                    const position = vehicle.position;
                    
                    allBuses.push({
                      vehicleID: vehicle.vehicle?.id || vehicle.vehicle?.label || entity.id || 'Unknown',
                      routeNumber: trip.routeId || null,
                      direction: trip.directionId !== undefined ? parseInt(trip.directionId) : null,
                      latitude: position.latitude || null,
                      longitude: position.longitude || null,
                      blockID: trip.tripId || null,
                      speed: null,
                      tripId: trip.tripId || null
                    });
                  }
                });
              }
            } catch (error) {
              console.error('[attachRouteToMap] Error fetching GTFS-RT data:', error);
              return;
            }
          } else {
            // TriMet API format (default)
            const res = await fetch(`https://developer.trimet.org/ws/v2/vehicles?route=${routeNum}&appID=${apiKey}&json=true`);
            const data = await res.json();
            allBuses = data.resultSet.vehicle || [];
          }
          
          // Filter buses for this route and direction
          // GTFS-RT uses routeId which might match route_id, so try both routeNum and routeId
          const routeBuses = allBuses.filter(v => {
            const routeMatch = v.routeNumber == routeNum || String(v.routeNumber) === String(routeId);
            const directionMatch = v.direction == directionId || v.direction === directionId;
            return routeMatch && directionMatch;
          });
          
          // Remove old bus markers from map and overlayElements
          Object.keys(busMarkers).forEach(vehicleId => {
            const marker = busMarkers[vehicleId];
            if (marker && typeof marker.remove === "function") {
              marker.remove();
              // Remove from overlayElements.markers
              const index = overlayElements.markers.indexOf(marker);
              if (index > -1) {
                overlayElements.markers.splice(index, 1);
              }
            }
            delete busMarkers[vehicleId];
          });
          
          // Create markers for buses (matching "All Buses Mode" style)
          routeBuses.forEach(bus => {
            if (!bus.latitude || !bus.longitude) return; // blockID is optional for GTFS-RT
            
            // Create bus marker element matching createBusMarker style
            const busElement = document.createElement('div');
            busElement.style.textAlign = 'center';
            busElement.innerHTML = `
              <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid #fff;'>
                <span style='background:#fff;color:${routeColor};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;'>${routeNum}</span>${bus.vehicleID}
              </div>
              <div style='width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:12px solid ${routeColor};margin:auto;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));'></div>
            `;
            
            const busMarker = new maplibregl.Marker({
              element: busElement
            });
            busMarker.setLngLat([bus.longitude, bus.latitude]);
            
            // Create popup for bus (matching "All Buses Mode" style)
            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
              <div style='border:1px solid ${routeColor}; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:180px;'>
                <div style='text-align:center; margin-bottom:6px;'>
                  <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:6px;font-weight:bold;font-size:12px;'>🚌 Bus ${bus.vehicleID}</div>
                </div>
                <div style='margin-bottom:4px;'><strong>Route:</strong> ${routeNum}</div>
                <div style='margin-bottom:4px;'><strong>Direction:</strong> ${bus.direction}</div>
                <div style='margin-bottom:4px;'><strong>Speed:</strong> ${Math.round(bus.speed || 0)} mph</div>
                <div style='margin-bottom:4px;'><strong>Block:</strong> ${bus.blockID || bus.tripId || 'N/A'}</div>
              </div>
            `;
            
            const popup = new maplibregl.Popup().setDOMContent(popupContent);
            busMarker.setPopup(popup);
            busMarker.addTo(map);
            
            busMarkers[bus.vehicleID] = busMarker;
            overlayElements.markers.push(busMarker);
          });
          
          console.log(`[attachRouteToMap] Displayed ${routeBuses.length} buses for route ${routeNum} direction ${directionId}`);
        } catch (error) {
          console.error('[attachRouteToMap] Error fetching buses:', error);
        }
      }
      
      // Fetch buses immediately
      fetchAndDisplayBuses();
      
      // Update buses every 15 seconds
      const busInterval = setInterval(fetchAndDisplayBuses, 15000);
      overlayElements.intervals.push(busInterval);
    }
  };

  // ==== Wait for map load if needed ==========================================
  if (map.loaded && map.loaded()) {
    addRouteToMap();
  } else {
    map.once("load", addRouteToMap);
  }

  // ==== Cleanup handle =======================================================
  return {
    remove: function () {
      // Layers
      overlayElements.layers.forEach((layerId) => {
        if (map.getLayer && map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });

      // Sources
      overlayElements.sources.forEach((sourceId) => {
        if (map.getSource && map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      });

      // Markers
      overlayElements.markers.forEach((marker) => {
        if (marker && typeof marker.remove === "function") marker.remove();
      });

      // Controls / panels
      overlayElements.controls.forEach((el) => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });

      // Intervals (bus tracking)
      overlayElements.intervals.forEach((interval) => {
        if (interval) clearInterval(interval);
      });

      overlayElements.sources  = [];
      overlayElements.layers   = [];
      overlayElements.markers  = [];
      overlayElements.controls = [];
      overlayElements.intervals = [];
    }
  };
}

// Expose globally for both route pages and main map
window.attachRouteToMap = attachRouteToMap;

