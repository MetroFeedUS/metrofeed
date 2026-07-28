/**
 * Tier Configuration System
 * 
 * Determines which tier (Free, Premium, Admin) the current page is running.
 * Each page sets its tier via a data attribute or inline config.
 */

(function() {
  'use strict';
  
  // Detect tier from page filename or data attribute
  function detectTier() {
    // Check for explicit tier in page
    const pageElement = document.documentElement;
    const tierAttr = pageElement.getAttribute('data-tier');
    if (tierAttr) {
      return tierAttr.toLowerCase();
    }
    
    // Fallback: detect from filename
    const filename = window.location.pathname.split('/').pop() || '';
    if (filename === 'premium.html') return 'premium';
    if (filename === 'admin.html') return 'admin';
    if (filename === 'home.html' || filename === '' || filename === 'index.html') return 'free';
    
    // Default to free for safety
    return 'free';
  }
  
  // Get current tier
  const currentTier = detectTier();
  
  // Admin preview mode (stored in localStorage, only affects admin page)
  const ADMIN_PREVIEW_KEY = 'admin_preview_tier';
  
  function getEffectiveTier() {
    if (currentTier === 'admin') {
      // Admin can preview as Free or Premium
      const previewTier = localStorage.getItem(ADMIN_PREVIEW_KEY);
      if (previewTier === 'free' || previewTier === 'premium') {
        return previewTier;
      }
    }
    return currentTier;
  }
  
  // Feature flags based on tier
  const features = {
    // CSL (Crowdsourced Live) - Premium only
    csl: getEffectiveTier() === 'premium',
    
    // Sponsors - Free only
    sponsors: getEffectiveTier() === 'free',
    
    // Admin features - Admin only
    admin: currentTier === 'admin',
    
    // Debug UI - Admin only (or can be enabled for Premium later)
    debug: currentTier === 'admin'
  };
  
  // Export to window
  window.TIER_CONFIG = {
    current: currentTier,
    effective: getEffectiveTier(),
    features: features,
    
    // Admin preview controls
    setPreviewTier: function(tier) {
      if (currentTier === 'admin' && (tier === 'free' || tier === 'premium')) {
        localStorage.setItem(ADMIN_PREVIEW_KEY, tier);
        // Reload to apply changes
        window.location.reload();
      }
    },
    
    clearPreview: function() {
      if (currentTier === 'admin') {
        localStorage.removeItem(ADMIN_PREVIEW_KEY);
        window.location.reload();
      }
    },
    
    // Check if feature is enabled
    hasFeature: function(featureName) {
      return features[featureName] === true;
    }
  };
  
  // Log tier detection (only in dev/debug mode)
  if (currentTier === 'admin' || window.location.search.includes('debug=true')) {
    console.log('[TierConfig] Current tier:', currentTier);
    console.log('[TierConfig] Effective tier:', getEffectiveTier());
    console.log('[TierConfig] Features:', features);
  }
})();

