/**
 * Shared Camera Icon Definition
 * 
 * Provides a consistent camera marker icon for both the Traffic Cameras Editor
 * and the Portland index camera overlay.
 * 
 * Uses the existing MetroFeed traffic camera SVG: 004-cctv-camera.svg
 */

'use strict';

/**
 * Create a camera marker element using the existing MetroFeed camera SVG
 * @param {number} size - Size of the icon in pixels (default: 32)
 * @returns {HTMLElement} Marker element ready for MapLibre GL
 */
function createCameraMarkerElement(size) {
  size = size || 32;
  
  // Check if map is in dark mode (night style)
  // Check window.isNightMode (set in portlandindex.html) or map style
  const isDarkMode = (typeof window !== 'undefined' && window.isNightMode === true);
  
  // Determine filter based on dark mode
  // In dark mode: white (no brightness filter)
  // In light mode: black (brightness(0))
  const filterStyle = isDarkMode 
    ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' // White in dark mode
    : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5)) brightness(0)'; // Black in light mode
  
  const markerElement = document.createElement('div');
  markerElement.className = 'metrofeed-camera-icon';
  markerElement.style.width = `${size}px`;
  markerElement.style.height = `${size}px`;
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
         style="width: ${size}px; height: ${size}px; display: block; filter: ${filterStyle};" />
  `;
  
  return markerElement;
}

// Export to window for global access
window.createCameraMarkerElement = createCameraMarkerElement;

