/**
 * CSL (Crowdsourced Live) - Ghost Bus System
 * Allows users to create and contribute to crowdsourced "ghost buses" when official tracking is missing
 */

// CSL Configuration
const CSL_CONFIG = {
  // City-specific bus number validation
  busDigits: {
    'boston': 4,  // MBTA bus numbers are typically 4 digits
    'default': 4
  },
  
  // Rate limiting
  minUpdateInterval: 10000,  // 10 seconds minimum between updates
  maxUpdatesPerMinute: 5,
  
  // Expiration
  contributorTTL: 5 * 60 * 1000,  // 5 minutes
  roomExpiration: 10 * 60 * 1000,  // 10 minutes
  
  // GPS validation
  corridorRadius: 50,  // 50 meters
  stopProximityRadius: 50  // 50 meters
};

// CSL State
let cslState = {
  consentAccepted: false,
  gpsEnabled: false,
  activeRooms: new Map(),  // roomKey -> room data
  userContributions: new Map(),  // roomKey -> user contribution data
  roomAdapter: null
};

/**
 * RoomAdapter Interface
 * Defines the contract for room state management (mock or Firebase)
 */
class RoomAdapter {
  /**
   * Initialize the adapter
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('RoomAdapter.initialize() must be implemented');
  }
  
  /**
   * Create a new room
   * @param {string} roomKey - Room identifier
   * @param {Object} initialData - Initial room data
   * @returns {Promise<boolean>} - Success
   */
  async createRoom(roomKey, initialData) {
    throw new Error('RoomAdapter.createRoom() must be implemented');
  }
  
  /**
   * Check if a room exists
   * @param {string} roomKey - Room identifier
   * @returns {Promise<boolean>}
   */
  async roomExists(roomKey) {
    throw new Error('RoomAdapter.roomExists() must be implemented');
  }
  
  /**
   * Get room data
   * @param {string} roomKey - Room identifier
   * @returns {Promise<Object|null>}
   */
  async getRoom(roomKey) {
    throw new Error('RoomAdapter.getRoom() must be implemented');
  }
  
  /**
   * Subscribe to room updates
   * @param {string} roomKey - Room identifier
   * @param {Function} callback - Callback function (roomData) => void
   * @returns {Function} - Unsubscribe function
   */
  subscribeToRoom(roomKey, callback) {
    throw new Error('RoomAdapter.subscribeToRoom() must be implemented');
  }
  
  /**
   * Join room as contributor
   * @param {string} roomKey - Room identifier
   * @param {Object} contributorData - Contributor data
   * @returns {Promise<boolean>} - Success
   */
  async joinRoom(roomKey, contributorData) {
    throw new Error('RoomAdapter.joinRoom() must be implemented');
  }
  
  /**
   * Update contributor status
   * @param {string} roomKey - Room identifier
   * @param {string} userId - User identifier
   * @param {Object} update - Update data
   * @returns {Promise<boolean>} - Success
   */
  async updateContributor(roomKey, userId, update) {
    throw new Error('RoomAdapter.updateContributor() must be implemented');
  }
  
  /**
   * Update room state (aggregated)
   * @param {string} roomKey - Room identifier
   * @param {Object} stateUpdate - State update
   * @returns {Promise<boolean>} - Success
   */
  async updateRoomState(roomKey, stateUpdate) {
    throw new Error('RoomAdapter.updateRoomState() must be implemented');
  }
  
  /**
   * Leave room
   * @param {string} roomKey - Room identifier
   * @param {string} userId - User identifier
   * @returns {Promise<void>}
   */
  async leaveRoom(roomKey, userId) {
    throw new Error('RoomAdapter.leaveRoom() must be implemented');
  }
  
  /**
   * Get user ID (anonymous)
   * @returns {Promise<string>}
   */
  async getUserId() {
    throw new Error('RoomAdapter.getUserId() must be implemented');
  }
}

/**
 * MockRoomAdapter - For UI development
 * Stores room state in memory
 */
class MockRoomAdapter extends RoomAdapter {
  constructor() {
    super();
    this.rooms = new Map();
    this.contributors = new Map();  // roomKey -> Map<userId, contributorData>
    this.subscriptions = new Map();  // roomKey -> Set<callbacks>
    this.userId = `mock_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.lastUpdate = new Map();  // userId -> last update timestamp
  }
  
  async initialize() {
    console.log('[CSL MockAdapter] Initialized');
    return Promise.resolve();
  }
  
  async createRoom(roomKey, initialData) {
    if (this.rooms.has(roomKey)) {
      return false;  // Room already exists
    }
    
    this.rooms.set(roomKey, {
      ...initialData,
      createdAt: Date.now(),
      lastUpdate: Date.now()
    });
    this.contributors.set(roomKey, new Map());
    this.subscriptions.set(roomKey, new Set());
    
    console.log('[CSL MockAdapter] Created room:', roomKey);
    return true;
  }
  
  async roomExists(roomKey) {
    return this.rooms.has(roomKey);
  }
  
  async getRoom(roomKey) {
    return this.rooms.get(roomKey) || null;
  }
  
  subscribeToRoom(roomKey, callback) {
    if (!this.subscriptions.has(roomKey)) {
      this.subscriptions.set(roomKey, new Set());
    }
    this.subscriptions.get(roomKey).add(callback);
    
    // Immediately call with current data
    const roomData = this.rooms.get(roomKey);
    if (roomData) {
      callback(roomData);
    }
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(roomKey);
      if (subs) {
        subs.delete(callback);
      }
    };
  }
  
  async joinRoom(roomKey, contributorData) {
    if (!this.rooms.has(roomKey)) {
      return false;
    }
    
    if (!this.contributors.has(roomKey)) {
      this.contributors.set(roomKey, new Map());
    }
    
    const contributors = this.contributors.get(roomKey);
    contributors.set(this.userId, {
      ...contributorData,
      userId: this.userId,
      joinedAt: Date.now(),
      lastActivity: Date.now()
    });
    
    console.log('[CSL MockAdapter] User joined room:', roomKey);
    
    // Aggregate room state after joining
    this._aggregateRoomState(roomKey);
    
    return true;
  }
  
  async updateContributor(roomKey, userId, update) {
    const contributors = this.contributors.get(roomKey);
    if (!contributors || !contributors.has(userId)) {
      return false;
    }
    
    // Rate limiting check
    const lastUpdate = this.lastUpdate.get(userId) || 0;
    const now = Date.now();
    if (now - lastUpdate < CSL_CONFIG.minUpdateInterval) {
      console.warn('[CSL MockAdapter] Rate limit: too soon since last update');
      return false;
    }
    
    const contributor = contributors.get(userId);
    contributors.set(userId, {
      ...contributor,
      ...update,
      lastActivity: now,
      userId: userId
    });
    
    this.lastUpdate.set(userId, now);
    
    // Aggregate contributor data into room state
    this._aggregateRoomState(roomKey);
    
    return true;
  }
  
  /**
   * Aggregate contributor data into room state (simple majority vote)
   */
  _aggregateRoomState(roomKey) {
    const room = this.rooms.get(roomKey);
    const contributors = this.contributors.get(roomKey);
    
    if (!room || !contributors || contributors.size === 0) {
      return;
    }
    
    // Filter active contributors (within TTL)
    const now = Date.now();
    const activeContributors = Array.from(contributors.values()).filter(c => 
      now - c.lastActivity < CSL_CONFIG.contributorTTL
    );
    
    if (activeContributors.length === 0) {
      // No active contributors - room may expire soon
      return;
    }
    
    // Aggregate current stop (most common)
    const stopVotes = new Map();
    activeContributors.forEach(c => {
      const stopKey = c.currentStop || c.currentStopName || 'unknown';
      stopVotes.set(stopKey, (stopVotes.get(stopKey) || 0) + 1);
    });
    
    let maxVotes = 0;
    let consensusStop = null;
    let consensusStopName = null;
    
    stopVotes.forEach((votes, stopKey) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        consensusStop = stopKey;
        // Find the name from a contributor
        const contributor = activeContributors.find(c => 
          (c.currentStop || c.currentStopName) === stopKey
        );
        consensusStopName = contributor?.currentStopName || stopKey;
      }
    });
    
    // Aggregate next stop (if set)
    const nextStopVotes = new Map();
    activeContributors.forEach(c => {
      if (c.nextStop || c.nextStopName) {
        const nextKey = c.nextStop || c.nextStopName;
        nextStopVotes.set(nextKey, (nextStopVotes.get(nextKey) || 0) + 1);
      }
    });
    
    let consensusNextStop = null;
    let consensusNextStopName = null;
    if (nextStopVotes.size > 0) {
      let maxNextVotes = 0;
      nextStopVotes.forEach((votes, nextKey) => {
        if (votes > maxNextVotes) {
          maxNextVotes = votes;
          consensusNextStop = nextKey;
          const contributor = activeContributors.find(c => 
            (c.nextStop || c.nextStopName) === nextKey
          );
          consensusNextStopName = contributor?.nextStopName || nextKey;
        }
      });
    }
    
    // Update room state
    this.rooms.set(roomKey, {
      ...room,
      currentStop: consensusStop,
      currentStopName: consensusStopName,
      nextStop: consensusNextStop,
      nextStopName: consensusNextStopName,
      contributors: activeContributors.map(c => ({
        userId: c.userId,
        currentStop: c.currentStop,
        currentStopName: c.currentStopName,
        lastActivity: c.lastActivity
      })),
      lastUpdate: now
    });
    
    this._notifySubscribers(roomKey);
  }
  
  async updateRoomState(roomKey, stateUpdate) {
    const room = this.rooms.get(roomKey);
    if (!room) {
      return false;
    }
    
    this.rooms.set(roomKey, {
      ...room,
      ...stateUpdate,
      lastUpdate: Date.now()
    });
    
    this._notifySubscribers(roomKey);
    return true;
  }
  
  async leaveRoom(roomKey, userId) {
    const contributors = this.contributors.get(roomKey);
    if (contributors) {
      contributors.delete(userId);
      // Re-aggregate after leaving
      this._aggregateRoomState(roomKey);
    }
  }
  
  async getUserId() {
    return this.userId;
  }
  
  _notifySubscribers(roomKey) {
    const room = this.rooms.get(roomKey);
    const callbacks = this.subscriptions.get(roomKey);
    if (room && callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(room);
        } catch (e) {
          console.error('[CSL MockAdapter] Callback error:', e);
        }
      });
    }
  }
  
  // Cleanup expired rooms (called periodically)
  cleanup() {
    const now = Date.now();
    for (const [roomKey, room] of this.rooms.entries()) {
      if (now - room.lastUpdate > CSL_CONFIG.roomExpiration) {
        console.log('[CSL MockAdapter] Cleaning up expired room:', roomKey);
        this.rooms.delete(roomKey);
        this.contributors.delete(roomKey);
        this.subscriptions.delete(roomKey);
      }
    }
  }
}

// Initialize CSL with MockAdapter by default
let roomAdapter = new MockRoomAdapter();
cslState.roomAdapter = roomAdapter;

// Initialize adapter on load
roomAdapter.initialize().then(() => {
  console.log('[CSL] Room adapter initialized');
  // Start cleanup interval for mock adapter
  if (roomAdapter.cleanup) {
    setInterval(() => roomAdapter.cleanup(), 60000); // Every minute
  }
});

// ============================================================================
// UI FUNCTIONS
// ============================================================================

/**
 * Show CSL consent modal (required on first use)
 * @returns {Promise<{accepted: boolean, gpsEnabled: boolean}>}
 */
function showCSLConsentModal() {
  return new Promise((resolve) => {
    // Check if already accepted (stored in localStorage)
    const stored = localStorage.getItem('csl_consent');
    if (stored) {
      const parsed = JSON.parse(stored);
      cslState.consentAccepted = true;
      cslState.gpsEnabled = parsed.gpsEnabled || false;
      resolve({ accepted: true, gpsEnabled: cslState.gpsEnabled });
      return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'csl-consent-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: #1e1e1e;
      border: 2px solid #1E90FF;
      border-radius: 12px;
      padding: 30px;
      max-width: 600px;
      color: #fff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    `;
    
    content.innerHTML = `
      <h2 style="color: #1E90FF; margin-top: 0;">CSL (Crowdsourced Live) - Consent</h2>
      
      <div style="margin: 20px 0; line-height: 1.6;">
        <p><strong>CSL is a crowdsourced system</strong> that allows users to create and share "ghost bus" locations when official tracking is unavailable.</p>
        
        <p><strong>Important:</strong></p>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>CSL data is <strong>advisory only</strong> and not official</li>
          <li>CSL is powered by shared user input, not official feeds</li>
          <li>Use responsibly and verify information when possible</li>
        </ul>
        
        <p style="margin-top: 20px;"><strong>GPS-Assisted Mode (Optional):</strong></p>
        <label style="display: flex; align-items: start; margin: 10px 0; cursor: pointer;">
          <input type="checkbox" id="csl-gps-consent" style="margin-right: 10px; margin-top: 4px; cursor: pointer;">
          <span>Enable GPS-assisted CSL</span>
        </label>
        <div style="font-size: 0.9em; color: #888; margin-left: 26px; margin-top: 5px;">
          Uses coarse (~50m) location to verify bus location plausibility. Only active during CSL sessions. Can be disabled anytime.
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; margin-top: 30px;">
        <button id="csl-consent-accept" style="
          flex: 1;
          background: #1E90FF;
          color: #fff;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          font-size: 16px;
        ">I Accept</button>
        <button id="csl-consent-decline" style="
          flex: 1;
          background: #666;
          color: #fff;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          font-size: 16px;
        ">Decline</button>
      </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    document.getElementById('csl-consent-accept').onclick = () => {
      const gpsEnabled = document.getElementById('csl-gps-consent').checked;
      cslState.consentAccepted = true;
      cslState.gpsEnabled = gpsEnabled;
      
      // Store consent
      localStorage.setItem('csl_consent', JSON.stringify({
        accepted: true,
        gpsEnabled: gpsEnabled,
        timestamp: Date.now()
      }));
      
      document.body.removeChild(modal);
      resolve({ accepted: true, gpsEnabled: gpsEnabled });
    };
    
    document.getElementById('csl-consent-decline').onclick = () => {
      document.body.removeChild(modal);
      resolve({ accepted: false, gpsEnabled: false });
    };
  });
}

/**
 * Check if CSL is supported for current city
 * @returns {boolean}
 */
function isCSLSupported() {
  // For now, only Boston is supported
  const cityId = (window.CITY_CONFIG && window.CITY_CONFIG.cityId) || 
                 (typeof CITY_CONFIG !== 'undefined' && CITY_CONFIG.cityId) || 
                 'boston';
  return cityId === 'boston';  // Add more cities as needed
}

/**
 * Show "CSL not available" modal
 */
function showCSLNotAvailableModal() {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #1e1e1e;
    border: 2px solid #FF6B35;
    border-radius: 12px;
    padding: 30px;
    max-width: 500px;
    color: #fff;
    text-align: center;
  `;
  
  content.innerHTML = `
    <h2 style="color: #FF6B35; margin-top: 0;">CSL Not Available</h2>
    <p style="margin: 20px 0;">CSL (Crowdsourced Live) is not yet available for this city.</p>
    <button id="csl-not-available-close" style="
      background: #1E90FF;
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
      font-size: 16px;
      margin-top: 20px;
    ">Close</button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  document.getElementById('csl-not-available-close').onclick = () => {
    document.body.removeChild(modal);
  };
}

/**
 * Main CSL entry point - called from button click
 */
async function openCSL() {
  console.log('[CSL] Opening CSL...');
  
  // Check if CSL is supported
  if (!isCSLSupported()) {
    showCSLNotAvailableModal();
    return;
  }
  
  // Show consent modal if not already accepted
  const consent = await showCSLConsentModal();
  if (!consent.accepted) {
    console.log('[CSL] User declined consent');
    return;
  }
  
  // Open bus creation flow
  showCSLBusCreation();
}

/**
 * Show bus creation flow
 */
async function showCSLBusCreation() {
  console.log('[CSL] Opening bus creation...');
  
  // Ensure routeLoader is available
  if (!window.routeLoader) {
    alert('Route data not available. Please wait for the map to load.');
    return;
  }
  
  // Ensure routes index is loaded
  if (!window.routeLoader.isRoutesIndexLoaded()) {
    try {
      await window.routeLoader.loadRoutesIndex();
    } catch (e) {
      alert('Failed to load route data. Please try again.');
      return;
    }
  }
  
  const routesIndex = window.routeLoader.getRoutesIndex();
  if (!routesIndex || !routesIndex.routes) {
    alert('Route data not available.');
    return;
  }
  
  // Get city ID
  const cityId = (window.CITY_CONFIG && window.CITY_CONFIG.cityId) || 
                 (typeof CITY_CONFIG !== 'undefined' && CITY_CONFIG.cityId) || 
                 'boston';
  
  // Get bus digits config
  const busDigits = CSL_CONFIG.busDigits[cityId] || CSL_CONFIG.busDigits.default;
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'csl-bus-creation-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 100001;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #1e1e1e;
    border: 2px solid #1E90FF;
    border-radius: 12px;
    padding: 30px;
    max-width: 600px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    color: #fff;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
  `;
  
  content.innerHTML = `
    <h2 style="color: #1E90FF; margin-top: 0;">Create CSL Bus</h2>
    
    <div style="margin: 20px 0;">
      <label style="display: block; margin-bottom: 8px; font-weight: bold;">Route:</label>
      <select id="csl-route-select" style="
        width: 100%;
        padding: 10px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #555;
        border-radius: 6px;
        font-size: 16px;
      ">
        <option value="">Select a route...</option>
      </select>
    </div>
    
    <div style="margin: 20px 0;">
      <label style="display: block; margin-bottom: 8px; font-weight: bold;">Direction:</label>
      <select id="csl-direction-select" style="
        width: 100%;
        padding: 10px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #555;
        border-radius: 6px;
        font-size: 16px;
      " disabled>
        <option value="">Select route first...</option>
      </select>
    </div>
    
    <div style="margin: 20px 0;">
      <label style="display: block; margin-bottom: 8px; font-weight: bold;">Bus Number (${busDigits} digits):</label>
      <input type="text" id="csl-bus-number" placeholder="e.g., 5487" maxlength="${busDigits}" pattern="\\d{${busDigits}}" style="
        width: 100%;
        padding: 10px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #555;
        border-radius: 6px;
        font-size: 16px;
      ">
      <div style="font-size: 0.9em; color: #888; margin-top: 5px;">Enter exactly ${busDigits} digits</div>
    </div>
    
    <div style="margin: 20px 0;">
      <label style="display: block; margin-bottom: 8px; font-weight: bold;">Starting Stop:</label>
      <select id="csl-starting-stop" style="
        width: 100%;
        padding: 10px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #555;
        border-radius: 6px;
        font-size: 16px;
      " disabled>
        <option value="">Select route and direction first...</option>
      </select>
    </div>
    
    <div style="display: flex; gap: 10px; margin-top: 30px;">
      <button id="csl-create-bus" style="
        flex: 1;
        background: #1E90FF;
        color: #fff;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
        font-size: 16px;
      " disabled>Create Bus</button>
      <button id="csl-cancel-creation" style="
        flex: 1;
        background: #666;
        color: #fff;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
        font-size: 16px;
      ">Cancel</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Populate routes dropdown
  const routeSelect = document.getElementById('csl-route-select');
  const directionSelect = document.getElementById('csl-direction-select');
  const busNumberInput = document.getElementById('csl-bus-number');
  const startingStopSelect = document.getElementById('csl-starting-stop');
  const createBtn = document.getElementById('csl-create-bus');
  
  // Group routes by route_id (combine directions)
  const routeMap = new Map();
  routesIndex.routes.forEach(route => {
    const routeId = route.route_id;
    if (!routeMap.has(routeId)) {
      routeMap.set(routeId, {
        route_id: routeId,
        route_title: route.route_title || routeId,
        directions: []
      });
    }
    routeMap.get(routeId).directions.push({
      direction_id: route.direction_id,
      direction_name: route.direction_name || `Direction ${route.direction_id}`
    });
  });
  
  // Sort routes: subway/rail first, then bus routes
  const sortedRoutes = Array.from(routeMap.values()).sort((a, b) => {
    const aIsSubway = ['Red', 'Orange', 'Blue', 'Green', 'CR-'].some(prefix => a.route_id.startsWith(prefix));
    const bIsSubway = ['Red', 'Orange', 'Blue', 'Green', 'CR-'].some(prefix => b.route_id.startsWith(prefix));
    if (aIsSubway && !bIsSubway) return -1;
    if (!aIsSubway && bIsSubway) return 1;
    return a.route_id.localeCompare(b.route_id);
  });
  
  sortedRoutes.forEach(route => {
    const option = document.createElement('option');
    option.value = route.route_id;
    option.textContent = `${route.route_id} - ${route.route_title}`;
    routeSelect.appendChild(option);
  });
  
  let selectedRouteId = null;
  let selectedDirectionId = null;
  let routeData = null;
  
  // Route selection handler
  routeSelect.onchange = async () => {
    selectedRouteId = routeSelect.value;
    directionSelect.innerHTML = '<option value="">Select direction...</option>';
    directionSelect.disabled = !selectedRouteId;
    startingStopSelect.innerHTML = '<option value="">Select route and direction first...</option>';
    startingStopSelect.disabled = true;
    createBtn.disabled = true;
    
    if (!selectedRouteId) return;
    
    // Populate directions
    const route = routeMap.get(selectedRouteId);
    route.directions.forEach(dir => {
      const option = document.createElement('option');
      option.value = dir.direction_id;
      option.textContent = dir.direction_name;
      directionSelect.appendChild(option);
    });
  };
  
  // Direction selection handler
  directionSelect.onchange = async () => {
    selectedDirectionId = parseInt(directionSelect.value);
    startingStopSelect.innerHTML = '<option value="">Loading stops...</option>';
    startingStopSelect.disabled = true;
    createBtn.disabled = true;
    
    if (!selectedRouteId || selectedDirectionId === null) return;
    
    try {
      // Load route data
      routeData = await window.routeLoader.loadRoute(selectedRouteId, selectedDirectionId);
      
      // Populate stops
      startingStopSelect.innerHTML = '<option value="">Select starting stop...</option>';
      if (routeData && routeData.stops && routeData.stops.length > 0) {
        routeData.stops.forEach((stop, idx) => {
          const option = document.createElement('option');
          option.value = stop.stop_id || idx;
          option.textContent = stop.name || `Stop ${idx + 1}`;
          startingStopSelect.appendChild(option);
        });
        startingStopSelect.disabled = false;
      } else {
        startingStopSelect.innerHTML = '<option value="">No stops available</option>';
      }
    } catch (e) {
      console.error('[CSL] Error loading route data:', e);
      startingStopSelect.innerHTML = '<option value="">Error loading stops</option>';
      alert('Failed to load route stops. Please try again.');
    }
  };
  
  // Bus number validation
  busNumberInput.oninput = () => {
    const value = busNumberInput.value.replace(/\D/g, ''); // Remove non-digits
    busNumberInput.value = value;
    validateForm();
  };
  
  // Starting stop selection handler
  startingStopSelect.onchange = () => {
    validateForm();
  };
  
  function validateForm() {
    const busNumber = busNumberInput.value.trim();
    const startingStop = startingStopSelect.value;
    
    const isValid = 
      selectedRouteId && 
      selectedDirectionId !== null && 
      busNumber.length === busDigits && 
      /^\d+$/.test(busNumber) &&
      startingStop;
    
    createBtn.disabled = !isValid;
  }
  
  // Create button handler
  createBtn.onclick = async () => {
    const busNumber = busNumberInput.value.trim();
    const startingStopId = startingStopSelect.value;
    const startingStopName = startingStopSelect.options[startingStopSelect.selectedIndex].text;
    
    if (!selectedRouteId || selectedDirectionId === null || !busNumber || !startingStopId) {
      return;
    }
    
    // Generate room key
    const roomKey = `${cityId}:${selectedRouteId}:${selectedDirectionId}:${busNumber}`;
    
    // Check if room already exists
    const adapter = window.CSL.getAdapter();
    const exists = await adapter.roomExists(roomKey);
    
    if (exists) {
      // Room exists - join it
      const userId = await adapter.getUserId();
      await adapter.joinRoom(roomKey, {
        currentStop: startingStopId,
        currentStopName: startingStopName
      });
      
      // Close creation modal
      document.body.removeChild(modal);
      
      // Open CSL bus modal
      showCSLBusModal(roomKey, selectedRouteId, selectedDirectionId, busNumber, routeData);
    } else {
      // Create new room
      const initialData = {
        cityId: cityId,
        routeId: selectedRouteId,
        directionId: selectedDirectionId,
        busNumber: busNumber,
        routeTitle: routeMap.get(selectedRouteId).route_title,
        stops: routeData.stops || [],
        shape: routeData.shape || null,
        currentStop: startingStopId,
        currentStopName: startingStopName,
        nextStop: null,
        nextStopName: null,
        contributors: [],
        confidence: 0,
        createdAt: Date.now()
      };
      
      const created = await adapter.createRoom(roomKey, initialData);
      if (!created) {
        alert('Failed to create room. It may already exist.');
        return;
      }
      
      // Join as contributor
      const userId = await adapter.getUserId();
      await adapter.joinRoom(roomKey, {
        currentStop: startingStopId,
        currentStopName: startingStopName
      });
      
      // Close creation modal
      document.body.removeChild(modal);
      
      // Open CSL bus modal
      showCSLBusModal(roomKey, selectedRouteId, selectedDirectionId, busNumber, routeData);
    }
  };
  
  // Cancel button handler
  document.getElementById('csl-cancel-creation').onclick = () => {
    document.body.removeChild(modal);
  };
}

/**
 * Show CSL bus modal (main interface for viewing/contributing to a CSL bus)
 */
function showCSLBusModal(roomKey, routeId, directionId, busNumber, routeData) {
  console.log('[CSL] Opening bus modal for:', roomKey);
  
  const adapter = window.CSL.getAdapter();
  
  // Remove existing modal if present
  const existing = document.getElementById('csl-bus-modal');
  if (existing) {
    existing.remove();
  }
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'csl-bus-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #1e1e1e;
    border: 2px solid #1E90FF;
    border-radius: 12px;
    padding: 20px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    color: #fff;
    z-index: 100002;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Get initial room data
  let roomData = null;
  let unsubscribe = null;
  
  function updateModal(data) {
    roomData = data;
    
    // Calculate confidence (based on contributor count and agreement)
    const contributorCount = data.contributors ? data.contributors.length : 0;
    const confidence = Math.min(100, contributorCount * 20); // 20% per contributor, max 100%
    
    // Get current stop name
    const currentStopName = data.currentStopName || 'Unknown';
    const nextStopName = data.nextStopName || 'Not set';
    
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h2 style="color: #1E90FF; margin: 0;">CSL Bus ${busNumber}</h2>
        <button id="csl-close-modal" style="
          background: transparent;
          color: #fff;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 30px;
          height: 30px;
          line-height: 1;
        ">×</button>
      </div>
      
      <div style="margin-bottom: 15px; padding: 15px; background: #2a2a2a; border-radius: 8px;">
        <div style="font-size: 0.9em; color: #888; margin-bottom: 5px;">Route</div>
        <div style="font-size: 1.2em; font-weight: bold;">${routeId} - ${data.routeTitle || routeId}</div>
        <div style="font-size: 0.9em; color: #888; margin-top: 5px;">Direction ${directionId}</div>
      </div>
      
      <div style="margin-bottom: 15px; padding: 15px; background: #2a2a2a; border-radius: 8px;">
        <div style="font-size: 0.9em; color: #888; margin-bottom: 5px;">Current Stop</div>
        <div style="font-size: 1.1em; font-weight: bold;">${currentStopName}</div>
        ${nextStopName !== 'Not set' ? `
          <div style="font-size: 0.9em; color: #888; margin-top: 5px;">Next: ${nextStopName}</div>
        ` : ''}
      </div>
      
      <div style="margin-bottom: 15px; padding: 15px; background: #2a2a2a; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 0.9em; color: #888; margin-bottom: 5px;">Confidence</div>
            <div style="font-size: 1.1em; font-weight: bold;">${confidence}%</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.9em; color: #888; margin-bottom: 5px;">Contributors</div>
            <div style="font-size: 1.1em; font-weight: bold;">${contributorCount}</div>
          </div>
        </div>
        <div style="margin-top: 10px; height: 8px; background: #333; border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${confidence}%; background: ${confidence >= 60 ? '#4CAF50' : confidence >= 30 ? '#FF9800' : '#F44336'}; transition: width 0.3s;"></div>
        </div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <div style="font-size: 0.9em; color: #888; margin-bottom: 10px;">Update Status (Contributors Only)</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <button id="csl-departed" class="csl-action-btn" style="
            background: #4CAF50;
            color: #fff;
            border: none;
            padding: 12px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
          ">Departed</button>
          <button id="csl-arrived" class="csl-action-btn" style="
            background: #2196F3;
            color: #fff;
            border: none;
            padding: 12px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
          ">Arrived</button>
          <button id="csl-late" class="csl-action-btn" style="
            background: #FF9800;
            color: #fff;
            border: none;
            padding: 12px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            grid-column: 1 / -1;
          ">Running Late</button>
        </div>
      </div>
      
      <div style="font-size: 0.85em; color: #888; text-align: center; margin-top: 20px;">
        CSL data is advisory only and not official
      </div>
    `;
    
    // Add event listeners
    document.getElementById('csl-close-modal').onclick = () => {
      if (unsubscribe) unsubscribe();
      document.body.removeChild(modal);
    };
    
    // Action buttons (only if user is a contributor)
    adapter.getUserId().then(async (userId) => {
      const isContributor = data.contributors && data.contributors.some(c => c.userId === userId);
      
      if (isContributor) {
        // Departed button
        document.getElementById('csl-departed').onclick = async () => {
          const currentStopIdx = routeData.stops.findIndex(s => 
            (s.stop_id && s.stop_id === data.currentStop) || 
            (s.name === data.currentStopName)
          );
          if (currentStopIdx >= 0 && currentStopIdx < routeData.stops.length - 1) {
            const nextStop = routeData.stops[currentStopIdx + 1];
            await adapter.updateContributor(roomKey, userId, {
              currentStop: nextStop.stop_id || currentStopIdx + 1,
              currentStopName: nextStop.name
            });
            // Aggregate update will happen via subscription
          }
        };
        
        // Arrived button
        document.getElementById('csl-arrived').onclick = async () => {
          // Mark as arrived at current stop
          await adapter.updateContributor(roomKey, userId, {
            arrived: true,
            arrivedAt: Date.now()
          });
        };
        
        // Late button
        document.getElementById('csl-late').onclick = async () => {
          await adapter.updateContributor(roomKey, userId, {
            late: true,
            lateReportedAt: Date.now()
          });
        };
      } else {
        // Disable buttons if not a contributor
        document.querySelectorAll('.csl-action-btn').forEach(btn => {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        });
      }
    });
  }
  
  // Subscribe to room updates
  adapter.getRoom(roomKey).then(initialData => {
    if (initialData) {
      updateModal(initialData);
    }
    
    // Subscribe to real-time updates
    unsubscribe = adapter.subscribeToRoom(roomKey, (data) => {
      updateModal(data);
    });
  });
  
  document.body.appendChild(modal);
}

// Export to window for global access
window.CSL = {
  config: CSL_CONFIG,
  state: cslState,
  RoomAdapter,
  MockRoomAdapter,
  setAdapter: (adapter) => {
    roomAdapter = adapter;
    cslState.roomAdapter = adapter;
  },
  getAdapter: () => roomAdapter,
  openCSL,
  showCSLConsentModal,
  isCSLSupported,
  showCSLBusModal
};

