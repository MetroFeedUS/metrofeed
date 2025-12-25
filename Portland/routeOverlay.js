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
    const nowPT   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const nowMins = nowPT.getHours() * 60 + nowPT.getMinutes();

    stops.forEach((stop) => {
      const lat = stop.lat;
      const lon = stop.lon;

      if (typeof lat !== "number" || typeof lon !== "number") return;

      // Highlight next time and limit to next 10 times
      const highlightedTimes = [];
      let   foundNext        = false;
      const maxTimesToShow   = 10; // Limit to next 10 times
      let   timesAdded       = 0;

      if (Array.isArray(stop.times)) {
        // First, collect all future times with their scheduled minutes
        const futureTimes = [];
        stop.times.forEach((timeStrRaw) => {
          let cleanTime = String(timeStrRaw).trim();
          let schedMins;

          // Case 1: "H:MM AM/PM"
          if (cleanTime.includes("AM") || cleanTime.includes("PM")) {
            const parts = cleanTime.split(" ");
            const timePart = parts[0];
            const ampm  = parts[1];
            const [hStr, mStr] = timePart.split(":");
            let h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);
            if (ampm === "PM" && h !== 12) h += 12;
            if (ampm === "AM" && h === 12) h = 0;
            schedMins = h * 60 + m;
          } else {
            // Case 2: "HH:MM:SS"
            const [hStr, mStr] = cleanTime.split(":");
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);
            schedMins = h * 60 + m;

            // Convert to 12-hour display
            let displayH = h;
            let ampm     = displayH >= 12 ? "PM" : "AM";
            if (displayH > 12) displayH -= 12;
            if (displayH === 0) displayH = 12;
            cleanTime = `${displayH}:${mStr} ${ampm}`;
          }

          // Handle "after midnight" wrap
          if (schedMins < nowMins && nowMins - schedMins > 720) {
            schedMins += 1440;
          }

          // Only include future times
          if (schedMins >= nowMins) {
            futureTimes.push({ cleanTime, schedMins });
          }
        });

        // Sort by scheduled time
        futureTimes.sort((a, b) => a.schedMins - b.schedMins);

        // Add up to maxTimesToShow times, highlighting the first one
        futureTimes.slice(0, maxTimesToShow).forEach((timeData, index) => {
          if (index === 0) {
            // Highlight the next upcoming time
            highlightedTimes.push(
              `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${timeData.cleanTime}</span>`
            );
          } else {
            highlightedTimes.push(timeData.cleanTime);
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
      routeInfoPanel.onclick = (e) => {
        if (isCollapsed) {
          // Only expand if clicking the circle itself (not buttons)
          if (e.target === routeInfoPanel || e.target.classList.contains('route-name-collapsed')) {
            isCollapsed = false;
            collapseBtn.onclick({ stopPropagation: () => {} });
          }
        }
      };
      
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          // Collapse to right side - circle with route number
          routeInfoPanel.style.left = "calc(100% - 60px)"; // Position from right edge with some margin
          routeInfoPanel.style.transform = "translateY(-50%)";
          routeInfoPanel.style.width = "50px";
          routeInfoPanel.style.height = "50px";
          routeInfoPanel.style.minWidth = "50px";
          routeInfoPanel.style.maxWidth = "50px";
          routeInfoPanel.style.minHeight = "50px";
          routeInfoPanel.style.maxHeight = "50px";
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
            collapsedName.style.fontSize = "1.2rem";
          }
        } else {
          // Expand back to center - restore original panel styles
          routeInfoPanel.style.left = "50%";
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
      contentDiv.innerHTML = `
        <div style="margin-bottom:8px; padding-right:20px;">
          <strong style="color:#1E90FF;font-size:1em;">${routeTitle}</strong>
        </div>
        <a href="${options.routePageUrl}"
           style="color:#1E90FF;text-decoration:none;font-weight:bold;display:inline-block;margin-top:8px;font-size:0.9em;"
           target="_blank">
          Open full route page →
        </a>
      `;
      
      // Collapsed route number (circle display)
      const collapsedName = document.createElement("div");
      collapsedName.className = "route-name-collapsed";
      // Extract route number from route title (e.g., "Route 15" -> "15", "MAX Red Line" -> "Red")
      let routeNumber = routeTitle;
      // Try to extract number first
      const numberMatch = routeTitle.match(/\d+/);
      if (numberMatch) {
        routeNumber = numberMatch[0];
      } else {
        // If no number, try to get first word or abbreviation
        const words = routeTitle.split(' ');
        if (words.length > 1 && words[0].toUpperCase() === 'MAX') {
          // For MAX lines, use color name (Red, Blue, etc.)
          routeNumber = words[1] || words[0];
        } else {
          routeNumber = words[0];
        }
        // Limit to 3 characters for circle
        routeNumber = routeNumber.substring(0, 3);
      }
      collapsedName.innerHTML = routeNumber;
      collapsedName.style.cssText = `
        display:none;
        position:relative;
        color:#fff;
        font-weight:bold;
        font-size:1.2rem;
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
          
          const res = await fetch(`https://developer.trimet.org/ws/v2/vehicles?route=${routeNum}&appID=${apiKey}&json=true`);
          const data = await res.json();
          const allBuses = data.resultSet.vehicle || [];
          
          // Filter buses for this route and direction
          const routeBuses = allBuses.filter(v => 
            v.routeNumber == routeNum && v.direction == directionId
          );
          
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
            if (!bus.latitude || !bus.longitude || !bus.blockID) return;
            
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
                <div style='margin-bottom:4px;'><strong>Block:</strong> ${bus.blockID}</div>
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
