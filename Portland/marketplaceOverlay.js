/**
 * Marketplace Overlay Module
 * 
 * Handles the marketplace overlay functionality for MetroFeed map.
 * Displays vending machine locations on the map.
 * 
 * Data Source: data/marketplace.json (single source of truth)
 * 
 * Feature Toggle: Set MARKETPLACE_ENABLED to true/false to enable/disable the feature
 * - When disabled: Shows a popup modal explaining the feature is coming soon
 * - When enabled: Shows map markers if locations exist
 * 
 * To update marketplace locations:
 * 1. Open MarketplaceEditor.html in browser
 * 2. Place pins on map for each vending machine location
 * 3. Export JSON and paste into data/marketplace.json
 * 4. Deploy the updated file
 * 
 * Usage:
 *   MarketplaceOverlay.init(map);
 *   MarketplaceOverlay.toggle();
 */

const MarketplaceOverlay = (function() {
  'use strict';

  // Feature toggle - set to true when ready to launch
  const MARKETPLACE_ENABLED = false;

  // Inject CSS to prevent marker lag/float during zoom
  if (!document.getElementById('metrofeed-marketplace-icon-styles')) {
    const style = document.createElement('style');
    style.id = 'metrofeed-marketplace-icon-styles';
    style.textContent = `
      .metrofeed-marketplace-icon,
      .metrofeed-marketplace-icon * {
        transition: none !important;
        animation: none !important;
      }
      .metrofeed-marketplace-icon img {
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  // Private variables
  let map = null;
  let marketplaceMarkers = [];
  let marketplaceActive = false;
  let marketplaceData = null;
  let isLoading = false;

  // Configuration
  const MARKETPLACE_JSON_URL = 'data/marketplace.json';
  const MARKER_SIZE = 32; // Size for marketplace icon
  const MARKER_COLOR = '#FF6B35'; // MetroFeed orange color for marketplace popups

  /**
   * Initialize the overlay with a map instance
   * @param {maplibregl.Map} mapInstance - The MapLibre GL map instance
   */
  function init(mapInstance) {
    if (!mapInstance) {
      console.error('[MarketplaceOverlay] Map instance is required');
      return;
    }
    map = mapInstance;
    console.log('[MarketplaceOverlay] Initialized');
  }

  /**
   * Load marketplace data from JSON file
   * @returns {Promise<Array>} Array of marketplace location objects
   */
  async function loadMarketplaceData() {
    // Return cached data if available
    if (marketplaceData) {
      return marketplaceData;
    }

    // Prevent multiple simultaneous loads
    if (isLoading) {
      console.log('[MarketplaceOverlay] Already loading marketplace data...');
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!isLoading && marketplaceData) {
            clearInterval(checkInterval);
            resolve(marketplaceData);
          }
        }, 100);
      });
    }

    isLoading = true;
    console.log('[MarketplaceOverlay] Loading marketplace data from:', MARKETPLACE_JSON_URL);

    try {
      const response = await fetch(MARKETPLACE_JSON_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      marketplaceData = await response.json();
      console.log('[MarketplaceOverlay] Loaded', marketplaceData.length, 'marketplace locations');
      isLoading = false;
      return marketplaceData;
    } catch (error) {
      console.error('[MarketplaceOverlay] Error loading marketplace data:', error);
      isLoading = false;
      marketplaceData = []; // Set empty array to prevent retry loops
      return [];
    }
  }

  /**
   * Create a marketplace marker element
   * @param {Object} location - Marketplace location object with id, name, lat, lon
   * @returns {HTMLElement} Marker element
   */
  function createMarkerElement(location) {
    // Create marker element
    const markerElement = document.createElement('div');
    markerElement.className = 'metrofeed-marketplace-icon';
    markerElement.style.width = `${MARKER_SIZE}px`;
    markerElement.style.height = `${MARKER_SIZE}px`;
    markerElement.style.cursor = 'pointer';
    markerElement.style.display = 'flex';
    markerElement.style.alignItems = 'center';
    markerElement.style.justifyContent = 'center';
    markerElement.style.pointerEvents = 'auto';
    
    // Use store icon - always orange on map (#FF6B35)
    // Apply filter to make it orange: use sepia + hue-rotate + saturate to convert white to orange
    markerElement.innerHTML = `
      <img src="store.svg" 
           alt="Store" 
           style="width: ${MARKER_SIZE}px; height: ${MARKER_SIZE}px; display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)) brightness(0) saturate(100%) invert(58%) sepia(95%) saturate(2000%) hue-rotate(350deg) brightness(1.1);" 
           onerror="this.onerror=null; this.src='008-danger.svg';" />
    `;
    
    return markerElement;
  }

  /**
   * Create popup content for a marketplace marker
   * @param {Object} location - Marketplace location object
   * @returns {HTMLElement} Popup content element
   */
  function createPopupContent(location) {
    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
      <div style='border:2px solid ${MARKER_COLOR}; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:200px;'>
        <strong style='color:${MARKER_COLOR};'>🛒 ${location.name}</strong>
        ${location.description ? `<div style='font-size:0.85rem; color:#aaa; margin-top:4px;'>${location.description}</div>` : ''}
        ${location.address ? `<div style='font-size:0.85rem; color:#aaa; margin-top:4px;'>📍 ${location.address}</div>` : ''}
      </div>
    `;
    return popupContent;
  }

  /**
   * Add marketplace markers to the map
   * @param {Array} locations - Array of marketplace location objects
   */
  function addMarkers(locations) {
    if (!map) {
      console.error('[MarketplaceOverlay] Map not initialized');
      return;
    }

    // Clear existing markers
    removeMarkers();

    locations.forEach(location => {
      // Validate location data
      if (!location.lat || !location.lon || !location.id || !location.name) {
        console.warn('[MarketplaceOverlay] Skipping invalid location:', location);
        return;
      }

      // Create marker element
      const markerElement = createMarkerElement(location);
      
      // Create marker (no transitions - markers should move exactly with map)
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center' // Center anchor for proper positioning
      });
      marker.setLngLat([location.lon, location.lat]);
      
      // Create popup
      const popupContent = createPopupContent(location);
      const popup = new maplibregl.Popup().setDOMContent(popupContent);
      marker.setPopup(popup);
      
      // Add to map
      marker.addTo(map);
      marketplaceMarkers.push(marker);
    });

    console.log('[MarketplaceOverlay] Added', marketplaceMarkers.length, 'marketplace markers');
  }

  /**
   * Remove all marketplace markers from the map
   */
  function removeMarkers() {
    marketplaceMarkers.forEach(marker => {
      marker.remove();
    });
    marketplaceMarkers = [];
  }

  /**
   * Show "coming soon" modal when feature is disabled
   */
  function showComingSoonModal() {
    const modal = document.getElementById('marketplaceComingSoonModal');
    if (modal) {
      modal.style.display = 'flex';
      console.log('[MarketplaceOverlay] Showing coming soon modal');
    } else {
      console.warn('[MarketplaceOverlay] Coming soon modal not found');
    }
  }

  /**
   * Hide "coming soon" modal
   */
  function hideComingSoonModal() {
    const modal = document.getElementById('marketplaceComingSoonModal');
    if (modal) {
      modal.style.display = 'none';
      console.log('[MarketplaceOverlay] Coming soon modal closed');
    }
  }

  /**
   * Toggle marketplace overlay on/off
   */
  async function toggle() {
    // Check if feature is enabled
    if (!MARKETPLACE_ENABLED) {
      // Feature is disabled - show coming soon modal
      showComingSoonModal();
      return;
    }

    if (marketplaceActive) {
      // Turn off
      removeMarkers();
      marketplaceActive = false;
      console.log('[MarketplaceOverlay] Marketplace overlay disabled');
    } else {
      // Turn on
      if (!map) {
        console.error('[MarketplaceOverlay] Map not initialized');
        return;
      }

      // Load marketplace data
      const locations = await loadMarketplaceData();
      
      if (locations.length === 0) {
        console.warn('[MarketplaceOverlay] No marketplace locations available');
        // Still show coming soon modal if no locations
        showComingSoonModal();
        return;
      }

      // Add markers
      addMarkers(locations);
      marketplaceActive = true;
      console.log('[MarketplaceOverlay] Marketplace overlay enabled');
    }
  }

  /**
   * Check if marketplace overlay is currently active
   * @returns {boolean}
   */
  function isActive() {
    return marketplaceActive;
  }

  /**
   * Check if marketplace feature is enabled
   * @returns {boolean}
   */
  function isEnabled() {
    return MARKETPLACE_ENABLED;
  }

  // Public API
  return {
    init: init,
    toggle: toggle,
    isActive: isActive,
    isEnabled: isEnabled,
    hideComingSoonModal: hideComingSoonModal
  };
})();

