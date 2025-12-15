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
    controls: []
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

      // Highlight next time
      const highlightedTimes = [];
      let   foundNext        = false;

      if (Array.isArray(stop.times)) {
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

          if (!foundNext && schedMins >= nowMins) {
            highlightedTimes.push(
              `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${cleanTime}</span>`
            );
            foundNext = true;
          } else {
            highlightedTimes.push(cleanTime);
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
      
      // Create collapse button
      const collapseBtn = document.createElement("button");
      collapseBtn.innerHTML = "◀";
      collapseBtn.style.cssText = `
        position:absolute;
        right:-20px;
        top:50%;
        transform:translateY(-50%);
        background:#1E90FF;
        color:#fff;
        border:none;
        border-radius:4px 0 0 4px;
        padding:8px 4px;
        cursor:pointer;
        font-size:12px;
        z-index:1001;
        box-shadow:-2px 0 4px rgba(0,0,0,0.3);
      `;
      
      let isCollapsed = false;
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          routeInfoPanel.style.transform = "translate(calc(-100% + 20px), -50%)";
          routeInfoPanel.style.opacity = "0.7";
          collapseBtn.innerHTML = "▶";
          collapseBtn.style.right = "-20px";
          collapseBtn.style.borderRadius = "4px 0 0 4px";
          routeInfoPanel.querySelector(".route-info-content").style.display = "none";
        } else {
          routeInfoPanel.style.transform = "translate(-50%, -50%)";
          routeInfoPanel.style.opacity = "1";
          collapseBtn.innerHTML = "◀";
          collapseBtn.style.right = "-20px";
          collapseBtn.style.borderRadius = "4px 0 0 4px";
          routeInfoPanel.querySelector(".route-info-content").style.display = "block";
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
      
      routeInfoPanel.appendChild(closeBtn);
      routeInfoPanel.appendChild(contentDiv);
      routeInfoPanel.appendChild(collapseBtn);

      map.getContainer().appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
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

      overlayElements.sources  = [];
      overlayElements.layers   = [];
      overlayElements.markers  = [];
      overlayElements.controls = [];
    }
  };
}

// Expose globally for both route pages and main map
window.attachRouteToMap = attachRouteToMap;
