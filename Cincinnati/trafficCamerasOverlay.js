/**
 * Traffic Cameras Overlay Module
 * 
 * Handles the traffic camera overlay functionality for MetroFeed map.
 * Loads camera data from cameras.json and displays markers on the map.
 * 
 * Uses shared camera icon from cameraIcon.js (004-cctv-camera.svg)
 * 
 * Data Source: data/cameras.json (single source of truth)
 * - No Python scripts
 * - No CSV files
 * - No geocoding APIs
 * 
 * To update cameras:
 * 1. Edit camera list in TrafficCameras.html (if needed)
 * 2. Open TrafficCamerasEditor.html in browser
 * 3. Place pins on map for each camera
 * 4. Export JSON and paste into data/cameras.json
 * 5. Deploy the updated file
 * 
 * Usage:
 *   TrafficCamerasOverlay.init(map);
 *   TrafficCamerasOverlay.toggle();
 */

const TrafficCamerasOverlay = (function() {
  'use strict';

  // Inject CSS to prevent marker lag/float during zoom
  if (!document.getElementById('metrofeed-camera-icon-styles')) {
    const style = document.createElement('style');
    style.id = 'metrofeed-camera-icon-styles';
    style.textContent = `
      .metrofeed-camera-icon,
      .metrofeed-camera-icon * {
        transition: none !important;
        animation: none !important;
      }
      .metrofeed-camera-icon img {
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  // Private variables
  let map = null;
  let cameraMarkers = [];
  let camerasActive = false;
  let camerasData = null;
  let isLoading = false;

  // Configuration
  const CAMERAS_JSON_URL = 'data/cameras.json';
  const MARKER_SIZE = 32; // Size for camera icon
  /* Popup chrome uses page :root tokens (--rr-accent); marker SVG stays neutral. */

  /**
   * Initialize the overlay with a map instance
   * @param {maplibregl.Map} mapInstance - The MapLibre GL map instance
   */
  function init(mapInstance) {
    if (!mapInstance) {
      console.error('[TrafficCamerasOverlay] Map instance is required');
      return;
    }
    map = mapInstance;
    console.log('[TrafficCamerasOverlay] Initialized');
  }

  /**
   * Load camera data from JSON file
   * @returns {Promise<Array>} Array of camera objects
   */
  async function loadCamerasData() {
    // Return cached data if available
    if (camerasData) {
      return camerasData;
    }

    // Prevent multiple simultaneous loads
    if (isLoading) {
      console.log('[TrafficCamerasOverlay] Already loading cameras data...');
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!isLoading && camerasData) {
            clearInterval(checkInterval);
            resolve(camerasData);
          }
        }, 100);
      });
    }

    isLoading = true;
    const remoteUrl = (typeof window !== 'undefined' && window.CITY_CONFIG && window.CITY_CONFIG.camerasFeedUrl)
      ? String(window.CITY_CONFIG.camerasFeedUrl).trim()
      : null;
    const sourceUrl = remoteUrl || CAMERAS_JSON_URL;
    console.log('[TrafficCamerasOverlay] Loading cameras data from:', sourceUrl);

    try {
      const response = await fetch(sourceUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const raw = await response.json();
      const list = Array.isArray(raw) ? raw : (raw.cameras || raw.items || raw.data || []);
      camerasData = Array.isArray(list) ? list.map((c, idx) => {
        // Ohio cameras feed may only provide {id, lat, lon}. Keep url optional.
        const id = c.id != null ? String(c.id) : String(idx);
        return {
          id,
          name: c.name || c.title || `Camera ${id}`,
          description: c.description || c.location || c.name || '',
          lat: Number(c.lat ?? c.latitude),
          lon: Number(c.lon ?? c.lng ?? c.longitude),
          url: c.url || c.imageUrl || c.image_url || c.streamUrl || c.stream_url || ''
        };
      }).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon)) : [];
      console.log('[TrafficCamerasOverlay] Loaded', camerasData.length, 'cameras');
      isLoading = false;
      return camerasData;
    } catch (error) {
      console.error('[TrafficCamerasOverlay] Error loading cameras data:', error);
      isLoading = false;
      camerasData = []; // Set empty array to prevent retry loops
      return [];
    }
  }

  /**
   * Create a camera marker element using the shared camera icon
   * @param {Object} camera - Camera object with id, name, lat, lon, url
   * @returns {HTMLElement} Marker element
   */
  function createMarkerElement(camera) {
    // Check if map is in dark mode (night style)
    const isDarkMode = (typeof window !== 'undefined' && window.isNightMode === true);
    
    // Determine filter based on dark mode
    // In dark mode: white (no brightness filter)
    // In light mode: black (brightness(0))
    const filterStyle = isDarkMode 
      ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' // White in dark mode
      : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5)) brightness(0)'; // Black in light mode
    
    // Use shared camera icon function if available, otherwise create inline
    if (typeof createCameraMarkerElement === 'function') {
      const markerElement = createCameraMarkerElement(MARKER_SIZE);
      // Update the filter based on dark mode (override the default)
      const img = markerElement.querySelector('img');
      if (img) {
        img.style.filter = filterStyle;
      }
      return markerElement;
    }
    
    // Fallback: create marker element with SVG
    const markerElement = document.createElement('div');
    markerElement.className = 'metrofeed-camera-icon';
    markerElement.style.width = `${MARKER_SIZE}px`;
    markerElement.style.height = `${MARKER_SIZE}px`;
    markerElement.style.cursor = 'pointer';
    markerElement.style.display = 'flex';
    markerElement.style.alignItems = 'center';
    markerElement.style.justifyContent = 'center';
    markerElement.style.pointerEvents = 'auto';
    
    // Use the existing MetroFeed camera SVG
    // Apply filter based on dark mode: white in dark mode, black in light mode
    markerElement.innerHTML = `
      <img src="004-cctv-camera.svg" 
           alt="Camera" 
           style="width: ${MARKER_SIZE}px; height: ${MARKER_SIZE}px; display: block; filter: ${filterStyle};" />
    `;
    
    return markerElement;
  }

  /**
   * Create popup content for a camera marker
   * @param {Object} camera - Camera object
   * @returns {HTMLElement} Popup content element
   */
  function createPopupContent(camera) {
    const popupContent = document.createElement('div');
    const hasUrl = !!(camera && camera.url);
    popupContent.innerHTML = `
      <div style='border:1px solid var(--rr-silver-edge, rgba(226,232,240,0.42)); border-radius:8px; padding:10px; background:linear-gradient(180deg, var(--rr-charcoal-raised, #1a1b20) 0%, var(--rr-charcoal, #121214) 100%); color:var(--rr-silver, #e2e8f0); min-width:200px;'>
        <strong style='color:var(--rr-silver, #e2e8f0);'>📹 ${camera.name}</strong>
        ${camera.description && camera.description !== camera.name ? `<div style='font-size:0.85rem; color:var(--rr-silver-muted, #94a3b8); margin-top:4px;'>${camera.description}</div>` : ''}
        <hr style='border:none; border-top:1px solid var(--rr-silver-dim, rgba(226,232,240,0.14)); margin:6px 0;'>
        ${hasUrl ? `
        <button onclick='TrafficCamerasOverlay.showCameraFeed("${camera.id}", "${camera.name}", "${String(camera.url).replace(/'/g, "\\'")}"); event.stopPropagation();' 
                style='background:var(--rr-accent, #9333ea); color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:bold; width:100%; margin-top:6px;'>
          View Camera
        </button>
        ` : `<div style="font-size:0.85rem;color:var(--rr-silver-muted, #94a3b8);margin-top:6px;">Camera feed not available yet.</div>`}
      </div>
    `;
    return popupContent;
  }

  /**
   * Add camera markers to the map
   * @param {Array} cameras - Array of camera objects
   */
  function addMarkers(cameras) {
    if (!map) {
      console.error('[TrafficCamerasOverlay] Map not initialized');
      return;
    }

    // Clear existing markers
    removeMarkers();

    cameras.forEach(camera => {
      // Validate camera data
      if (!camera.lat || !camera.lon || !camera.id) {
        console.warn('[TrafficCamerasOverlay] Skipping invalid camera:', camera);
        return;
      }

      // Create marker element using shared camera icon
      const markerElement = createMarkerElement(camera);
      
      // Create marker (no transitions - markers should move exactly with map)
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center' // Center anchor for proper positioning
      });
      marker.setLngLat([camera.lon, camera.lat]);
      
      // Create popup
      const popupContent = createPopupContent(camera);
      const popup = new maplibregl.Popup().setDOMContent(popupContent);
      marker.setPopup(popup);
      
      // Add click handler to marker (only if feed URL exists)
      markerElement.addEventListener('click', () => {
        if (camera.url) showCameraFeed(camera.id, camera.name, camera.url);
      });
      
      // Add to map
      marker.addTo(map);
      cameraMarkers.push(marker);
    });

    console.log('[TrafficCamerasOverlay] Added', cameraMarkers.length, 'camera markers');
  }

  /**
   * Remove all camera markers from the map
   */
  function removeMarkers() {
    cameraMarkers.forEach(marker => {
      marker.remove();
    });
    cameraMarkers = [];
  }

  /**
   * Toggle camera overlay on/off
   */
  async function toggle() {
    if (camerasActive) {
      // Turn off
      removeMarkers();
      camerasActive = false;
      console.log('[TrafficCamerasOverlay] Camera overlay disabled');
      // Close modal if open
      hideCameraModal();
    } else {
      // Turn on
      if (!map) {
        console.error('[TrafficCamerasOverlay] Map not initialized');
        return;
      }

      // Load camera data
      const cameras = await loadCamerasData();
      
      if (cameras.length === 0) {
        console.warn('[TrafficCamerasOverlay] No camera data available');
        alert('Unable to load traffic camera data. Please check that cameras.json exists.');
        return;
      }

      // Add markers
      addMarkers(cameras);
      camerasActive = true;
      console.log('[TrafficCamerasOverlay] Camera overlay enabled');
    }
  }

  /**
   * Show camera feed in modal
   * @param {string} cameraId - Camera ID
   * @param {string} cameraName - Camera name
   * @param {string} imageUrl - Camera image URL
   */
  function showCameraFeed(cameraId, cameraName, imageUrl) {
    const modal = document.getElementById('cameraModal');
    const modalTitle = document.getElementById('cameraModalTitle');
    const modalImage = document.getElementById('cameraModalImage');
    const modalAttribution = document.getElementById('cameraModalAttribution');
    
    if (!modal || !modalTitle || !modalImage) {
      console.error('[TrafficCamerasOverlay] Camera modal elements not found');
      return;
    }

    modalTitle.textContent = cameraName;
    
    // Add timestamp to force refresh
    const timestamp = new Date().getTime();
    const separator = imageUrl.includes('?') ? '&' : '?';
    modalImage.src = imageUrl + separator + 't=' + timestamp;
    modalImage.alt = cameraName;
    
    if (modalAttribution) {
      modalAttribution.textContent = 'Camera courtesy of OHGO';
    }
    
    modal.style.display = 'flex';
    console.log('[TrafficCamerasOverlay] Showing camera feed for:', cameraId, cameraName);
  }

  /**
   * Hide camera modal
   */
  function hideCameraModal() {
    const modal = document.getElementById('cameraModal');
    if (modal) {
      modal.style.display = 'none';
      console.log('[TrafficCamerasOverlay] Camera modal closed');
    }
  }

  /**
   * Check if cameras overlay is currently active
   * @returns {boolean}
   */
  function isActive() {
    return camerasActive;
  }

  // Public API
  return {
    init: init,
    toggle: toggle,
    showCameraFeed: showCameraFeed,
    hideCameraModal: hideCameraModal,
    isActive: isActive,
    /** Load + return camera list without toggling markers. */
    getCamerasData: async function () {
      return await loadCamerasData();
    },
    /** Return whatever is currently cached (may be empty until loaded). */
    getCachedCameras: function () {
      return Array.isArray(camerasData) ? camerasData : [];
    }
  };
})();

