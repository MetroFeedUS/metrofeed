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
  
};

// CSL State
let cslState = {
  consentAccepted: false,
  activeRooms: new Map(),  // roomKey -> room data
  userContributions: new Map(),  // roomKey -> user contribution data
  roomAdapter: null,
  busMarkers: new Map()  // roomKey -> MapLibre marker
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
  
  /**
   * Get all active rooms (for public viewing)
   * @returns {Promise<Array<{roomKey: string, roomData: Object}>>}
   */
  async getAllActiveRooms() {
    throw new Error('RoomAdapter.getAllActiveRooms() must be implemented');
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
  
  async getAllActiveRooms() {
    const now = Date.now();
    const activeRooms = [];
    
    for (const [roomKey, room] of this.rooms.entries()) {
      // Only return rooms that haven't expired
      if (now - room.lastUpdate < CSL_CONFIG.roomExpiration) {
        activeRooms.push({
          roomKey: roomKey,
          roomData: room
        });
      }
    }
    
    return activeRooms;
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
 * @returns {Promise<{accepted: boolean}>}
 */
function showCSLConsentModal() {
  return new Promise((resolve) => {
    // Check if already accepted (stored in localStorage)
    const stored = localStorage.getItem('csl_consent');
    if (stored) {
      const parsed = JSON.parse(stored);
      cslState.consentAccepted = true;
      resolve({ accepted: true });
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
      cslState.consentAccepted = true;
      
      // Store consent
      localStorage.setItem('csl_consent', JSON.stringify({
        accepted: true,
        timestamp: Date.now()
      }));
      
      document.body.removeChild(modal);
      resolve({ accepted: true });
    };
    
    document.getElementById('csl-consent-decline').onclick = () => {
      document.body.removeChild(modal);
      resolve({ accepted: false });
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
 * Add or update CSL bus marker on map (matches normal bus marker style)
 */
function updateCSLBusMarker(roomKey, roomData, routeData) {
  if (!window.map || !roomData) {
    return;
  }
  
  // Find current stop coordinates
  const currentStop = routeData?.stops?.find(s => 
    (s.stop_id && s.stop_id === roomData.currentStop) || 
    s.name === roomData.currentStopName
  );
  
  if (!currentStop || !currentStop.lat || !currentStop.lon) {
    console.warn('[CSL] Cannot create marker - stop coordinates not found');
    return;
  }
  
  // Remove existing marker if present
  if (cslState.busMarkers.has(roomKey)) {
    cslState.busMarkers.get(roomKey).remove();
  }
  
  // Create marker element (same style as normal bus markers)
  const markerElement = document.createElement('div');
  markerElement.style.textAlign = 'center';
  markerElement.innerHTML = `
    <div style="background:#0071CE;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;font-size:12px;">${roomData.busNumber || '?'}</div>
    <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:10px solid #0071CE;margin:auto;"></div>
  `;
  
  // Create marker (anchored at bottom of triangle, not center)
  const marker = new maplibregl.Marker({
    element: markerElement,
    anchor: 'bottom'  // Anchor at bottom of triangle (stop location)
  })
    .setLngLat([currentStop.lon, currentStop.lat])
    .addTo(window.map);
  
  // Create popup (same style as normal bus popups)
  const popupContent = document.createElement('div');
  popupContent.innerHTML = `
    <div style='border:2px solid #0071CE; border-radius:10px; padding:12px; background:#222; color:#fff; min-width:200px;'>
      <div style='text-align:center; margin-bottom:8px;'>
        <div style='background:#0071CE;color:#fff;padding:4px 8px;border-radius:6px;font-weight:bold;font-size:14px;'>🚌 CSL Bus ${roomData.busNumber || '?'}</div>
      </div>
      <div style='margin-bottom:6px;'><strong>Route:</strong> ${roomData.routeId || 'N/A'}</div>
      <div style='margin-bottom:6px;'><strong>Direction:</strong> ${roomData.directionId !== undefined ? roomData.directionId : 'N/A'}</div>
      <div style='margin-bottom:6px;'><strong>Current Stop:</strong> ${roomData.currentStopName || 'Unknown'}</div>
      <div style='margin-bottom:6px;'><strong>Contributors:</strong> ${roomData.contributors ? roomData.contributors.length : 0}</div>
      <div style='margin-bottom:6px;'><strong>Confidence:</strong> ${Math.min(100, (roomData.contributors ? roomData.contributors.length : 0) * 20)}%</div>
      <div style='margin-top:8px; padding-top:8px; border-top:1px solid #444; font-size:0.85em; color:#aaa;'>CSL data is advisory only</div>
    </div>
  `;
  
  const popup = new maplibregl.Popup({ offset: 25 })
    .setDOMContent(popupContent);
  marker.setPopup(popup);
  
  // Click handler to show/view modal (for all users)
  markerElement.onclick = async (e) => {
    e.stopPropagation();
    // Check if user is a contributor
    const adapter = window.CSL.getAdapter();
    const userId = await adapter.getUserId();
    const room = await adapter.getRoom(roomKey);
    const isContributor = room && room.contributors && room.contributors.some(c => c.userId === userId);
    
    // Show modal (view-only if not contributor)
    const existingModal = document.getElementById(`csl-bus-modal-${roomKey}`);
    if (existingModal) {
      // Expand if collapsed
      if (existingModal.getAttribute('data-collapsed') === 'true') {
        const collapseBtn = existingModal.querySelector('#csl-collapse-btn');
        if (collapseBtn) collapseBtn.click();
      }
      // Bring to front
      existingModal.style.zIndex = '100003';
      setTimeout(() => {
        existingModal.style.zIndex = '100002';
      }, 100);
    } else {
      // Load route data if needed
      let routeDataForModal = routeData;
      if (!routeDataForModal && window.routeLoader) {
        try {
          routeDataForModal = await window.routeLoader.loadRoute(room.routeId, room.directionId);
        } catch (e) {
          console.warn('[CSL] Could not load route data for modal:', e);
        }
      }
      // Create new modal in view-only mode if not contributor
      showCSLBusModal(roomKey, room.routeId, room.directionId, room.busNumber, routeDataForModal, !isContributor);
    }
  };
  
  cslState.busMarkers.set(roomKey, marker);
}

/**
 * Remove CSL bus marker from map
 */
function removeCSLBusMarker(roomKey) {
  if (cslState.busMarkers.has(roomKey)) {
    cslState.busMarkers.get(roomKey).remove();
    cslState.busMarkers.delete(roomKey);
  }
}

/**
 * Show CSL bus modal (main interface for viewing/contributing to a CSL bus)
 */
function showCSLBusModal(roomKey, routeId, directionId, busNumber, routeData, viewOnly = false) {
  console.log('[CSL] Opening bus modal for:', roomKey, viewOnly ? '(view-only)' : '(contributor)');
  
  const adapter = window.CSL.getAdapter();
  
  // Remove existing modal if present
  const existing = document.getElementById(`csl-bus-modal-${roomKey}`);
  if (existing) {
    existing.remove();
  }
  
  // Find next available position for collapsed bars (above favorites bar)
  const allModals = Array.from(document.querySelectorAll('[id^="csl-bus-modal-"]'));
  const collapsedModals = allModals.filter(m => m.getAttribute('data-collapsed') === 'true');
  const modalIndex = collapsedModals.length;
  const barHeight = 40;
  const barSpacing = 8;
  const favoritesBarBottom = 40; // Favorites bar is at bottom: 40px
  const favoritesBarHeight = 50; // Approximate height of favorites bar
  const bottomOffset = favoritesBarBottom + favoritesBarHeight + 10; // 10px spacing above favorites
  const verticalOffset = bottomOffset + (modalIndex * (barHeight + barSpacing));
  
  // Helper function to get collapsed bar position
  function getCollapsedBarPosition(index) {
    return bottomOffset + (index * (barHeight + barSpacing));
  }
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = `csl-bus-modal-${roomKey}`;
  modal.setAttribute('data-room-key', roomKey);
  modal.setAttribute('data-collapsed', 'true');
  modal.setAttribute('data-collapse-index', modalIndex.toString());
  
  // Get initial room data
  let roomData = null;
  let unsubscribe = null;
  
  // Collapsed content (horizontal bar above favorites)
  const collapsedContent = document.createElement('div');
  collapsedContent.className = 'csl-collapsed-content';
  collapsedContent.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    gap: 10px;
  `;
  
  // Initial collapsed bar content
  collapsedContent.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
      <div style="background: #1E90FF; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">
        CSL Bus ${busNumber}
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.85em; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${routeId} - Loading...
        </div>
      </div>
    </div>
    <button id="csl-expand-from-bar" style="
      background: #1E90FF;
      color: #fff;
      border: none;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      font-weight: bold;
      white-space: nowrap;
    ">Expand</button>
  `;
  
  // Initial collapsed state (horizontal bar above favorites)
  modal.style.cssText = `
    position: fixed;
    bottom: ${getCollapsedBarPosition(modalIndex)}px;
    left: 50%;
    transform: translateX(-50%);
    width: auto;
    min-width: 300px;
    max-width: calc(50vw - 20px);
    height: ${barHeight}px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid #1E90FF;
    background: rgba(30,30,30,0.95);
    color: #fff;
    z-index: 100002;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Expanded content container
  const expandedContent = document.createElement('div');
  expandedContent.className = 'csl-expanded-content';
  expandedContent.style.cssText = `
    display: none;
    width: 100%;
    height: 100%;
  `;
  
  // Collapse button
  const collapseBtn = document.createElement('button');
  collapseBtn.id = 'csl-collapse-btn';
  collapseBtn.innerHTML = '▶';
  collapseBtn.style.cssText = `
    position: absolute;
    right: 32px;
    top: 4px;
    background: transparent;
    color: #fff;
    border: none;
    padding: 2px 6px;
    cursor: pointer;
    font-size: 16px;
    z-index: 1001;
    line-height: 1;
    display: none;
  `;
  collapseBtn.onmouseover = () => collapseBtn.style.background = 'rgba(255,255,255,0.2)';
  collapseBtn.onmouseout = () => collapseBtn.style.background = 'transparent';
  
  let isCollapsed = true;
  
  // Click handler for collapsed bar (expand on click)
  modal.onclick = (e) => {
    if (isCollapsed && !e.target.closest('button')) {
      collapseBtn.click();
    }
  };
  
  // Expand button in collapsed bar
  const expandFromBarBtn = collapsedContent.querySelector('#csl-expand-from-bar');
  if (expandFromBarBtn) {
    expandFromBarBtn.onclick = (e) => {
      e.stopPropagation();
      collapseBtn.click();
    };
  }
  
  collapseBtn.onclick = (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    
    if (isCollapsed) {
      // Collapse to horizontal bar above favorites
      modal.setAttribute('data-collapsed', 'true');
      // Recalculate position (in case other modals were added/removed)
      const currentIndex = parseInt(modal.getAttribute('data-collapse-index') || '0', 10);
      const currentBottom = getCollapsedBarPosition(currentIndex);
      modal.style.cssText = `
        position: fixed;
        bottom: ${currentBottom}px;
        left: 50%;
        transform: translateX(-50%);
        width: auto;
        min-width: 300px;
        max-width: calc(50vw - 20px);
        height: ${barHeight}px;
        padding: 0;
        border-radius: 8px;
        border: 1px solid #1E90FF;
        background: rgba(30,30,30,0.95);
        color: #fff;
        z-index: 100002;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      collapsedContent.style.display = 'flex';
      expandedContent.style.display = 'none';
      collapseBtn.style.display = 'none';
      collapseBtn.innerHTML = '▼';
    } else {
      // Expand
      modal.setAttribute('data-collapsed', 'false');
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
      collapsedContent.style.display = 'none';
      expandedContent.style.display = 'block';
      collapseBtn.style.display = 'block';
      collapseBtn.innerHTML = '◀';
    }
  };
  
  function updateModal(data) {
    roomData = data;
    
    // Update marker position
    updateCSLBusMarker(roomKey, data, routeData);
    
    // Calculate confidence (based on contributor count and agreement)
    const contributorCount = data.contributors ? data.contributors.length : 0;
    const confidence = Math.min(100, contributorCount * 20); // 20% per contributor, max 100%
    
    // Get current stop name
    const currentStopName = data.currentStopName || 'Unknown';
    const nextStopName = data.nextStopName || 'Not set';
    
    expandedContent.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h2 style="color: #1E90FF; margin: 0;">CSL Bus ${busNumber}</h2>
        <div style="display: flex; gap: 10px; align-items: center;">
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
      
      ${!viewOnly ? `
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
      ` : `
        <div style="margin-bottom: 15px; padding: 15px; background: #2a2a2a; border-radius: 8px; text-align: center;">
          <div style="font-size: 0.9em; color: #888; margin-bottom: 8px;">View Only</div>
          <button id="csl-join-as-contributor" style="
            background: #1E90FF;
            color: #fff;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            font-size: 14px;
          ">Join as Contributor</button>
        </div>
      `}
      
      <div style="font-size: 0.85em; color: #888; text-align: center; margin-top: 20px;">
        CSL data is advisory only and not official
      </div>
    `;
    
    // Add event listeners after content is set
    setTimeout(() => {
      const closeBtn = expandedContent.querySelector('#csl-close-modal');
      if (closeBtn) {
        closeBtn.onclick = () => {
          if (unsubscribe) unsubscribe();
          // Don't remove marker - it should stay visible for all users
          document.body.removeChild(modal);
        };
      }
      
      // Join as contributor button (view-only mode)
      const joinBtn = expandedContent.querySelector('#csl-join-as-contributor');
      if (joinBtn) {
        joinBtn.onclick = async () => {
          const userId = await adapter.getUserId();
          await adapter.joinRoom(roomKey, {
            currentStop: data.currentStop,
            currentStopName: data.currentStopName
          });
          // Reload modal in contributor mode
          document.body.removeChild(modal);
          showCSLBusModal(roomKey, routeId, directionId, busNumber, routeData, false);
        };
      }
      
      // Action buttons (only if user is a contributor and not view-only)
      if (!viewOnly) {
        adapter.getUserId().then(async (userId) => {
          const isContributor = data.contributors && data.contributors.some(c => c.userId === userId);
          
          if (isContributor) {
          // Departed button - marks bus as departed from current stop (doesn't move)
          const departedBtn = expandedContent.querySelector('#csl-departed');
          if (departedBtn) {
            departedBtn.onclick = async () => {
              await adapter.updateContributor(roomKey, userId, {
                departed: true,
                departedAt: Date.now()
              });
            };
          }
          
          // Arrived button - moves bus to next stop
          const arrivedBtn = expandedContent.querySelector('#csl-arrived');
          if (arrivedBtn) {
            arrivedBtn.onclick = async () => {
              // Find current stop index
              const currentStopIdx = routeData.stops.findIndex(s => 
                (s.stop_id && s.stop_id === data.currentStop) || 
                (s.name === data.currentStopName)
              );
              
              // Move to next stop
              if (currentStopIdx >= 0 && currentStopIdx < routeData.stops.length - 1) {
                const nextStop = routeData.stops[currentStopIdx + 1];
                await adapter.updateContributor(roomKey, userId, {
                  currentStop: nextStop.stop_id || (currentStopIdx + 1),
                  currentStopName: nextStop.name,
                  arrived: true,
                  arrivedAt: Date.now()
                });
                // Marker will update via subscription
              } else {
                // End of route
                await adapter.updateContributor(roomKey, userId, {
                  arrived: true,
                  arrivedAt: Date.now(),
                  endOfRoute: true
                });
              }
            };
          }
          
          // Late button
          const lateBtn = expandedContent.querySelector('#csl-late');
          if (lateBtn) {
            lateBtn.onclick = async () => {
              await adapter.updateContributor(roomKey, userId, {
                late: true,
                lateReportedAt: Date.now()
              });
            };
          }
        } else {
          // Disable buttons if not a contributor
          expandedContent.querySelectorAll('.csl-action-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
          });
        }
      });
    }
    }, 0);
  }
  
  // Append elements to modal
  modal.appendChild(collapsedContent);
  modal.appendChild(expandedContent);
  modal.appendChild(collapseBtn);
  
  // Initially show collapsed content only (horizontal bar)
  collapsedContent.style.display = 'flex';
  expandedContent.style.display = 'none';
  collapseBtn.style.display = 'none';
  
  // Subscribe to room updates
  adapter.getRoom(roomKey).then(initialData => {
    if (initialData) {
      updateModal(initialData);
      // Create marker on initial load
      updateCSLBusMarker(roomKey, initialData, routeData);
    }
    
    // Subscribe to real-time updates
    unsubscribe = adapter.subscribeToRoom(roomKey, (data) => {
      updateModal(data);
    });
  });
  
  document.body.appendChild(modal);
}

// ============================================================================
// TESTING & DEBUG UTILITIES
// ============================================================================

/**
 * Reset CSL state (for testing)
 */
function resetCSLState() {
  cslState.consentAccepted = false;
  cslState.activeRooms.clear();
  cslState.userContributions.clear();
  localStorage.removeItem('csl_consent');
  console.log('[CSL] State reset');
}

/**
 * Create a test room (for testing)
 */
async function createTestRoom(routeId = 'Red', directionId = 0, busNumber = '1234', startingStop = 'Alewife') {
  const cityId = (window.CITY_CONFIG && window.CITY_CONFIG.cityId) || 'boston';
  const roomKey = `${cityId}:${routeId}:${directionId}:${busNumber}`;
  
  const adapter = window.CSL.getAdapter();
  
  // Load route data
  let routeData = null;
  try {
    if (window.routeLoader) {
      routeData = await window.routeLoader.loadRoute(routeId, directionId);
    }
  } catch (e) {
    console.warn('[CSL Test] Could not load route data:', e);
  }
  
  // Find starting stop
  let startingStopId = startingStop;
  let startingStopName = startingStop;
  if (routeData && routeData.stops) {
    const stop = routeData.stops.find(s => 
      s.name === startingStop || s.stop_id === startingStop
    );
    if (stop) {
      startingStopId = stop.stop_id || startingStop;
      startingStopName = stop.name || startingStop;
    }
  }
  
  // Create room
  const initialData = {
    cityId: cityId,
    routeId: routeId,
    directionId: directionId,
    busNumber: busNumber,
    routeTitle: routeData?.route_title || routeId,
    stops: routeData?.stops || [],
    shape: routeData?.shape || null,
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
    console.warn('[CSL Test] Room already exists:', roomKey);
  }
  
  // Join as contributor
  const userId = await adapter.getUserId();
  await adapter.joinRoom(roomKey, {
    currentStop: startingStopId,
    currentStopName: startingStopName
  });
  
  console.log('[CSL Test] Created test room:', roomKey);
  
  // Open modal
  showCSLBusModal(roomKey, routeId, directionId, busNumber, routeData);
  
  return roomKey;
}

/**
 * Add test contributors to a room (for testing)
 */
async function addTestContributors(roomKey, count = 3) {
  const adapter = window.CSL.getAdapter();
  const room = await adapter.getRoom(roomKey);
  
  if (!room) {
    console.error('[CSL Test] Room not found:', roomKey);
    return;
  }
  
  // Get stops for random selection
  const stops = room.stops || [];
  if (stops.length === 0) {
    console.warn('[CSL Test] No stops available in room');
    return;
  }
  
  // Create test contributors with different stops
  for (let i = 0; i < count; i++) {
    const testUserId = `test_user_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
    const randomStop = stops[Math.floor(Math.random() * stops.length)];
    
    // Manually add to MockAdapter's contributors map
    if (adapter instanceof MockRoomAdapter) {
      if (!adapter.contributors.has(roomKey)) {
        adapter.contributors.set(roomKey, new Map());
      }
      adapter.contributors.get(roomKey).set(testUserId, {
        userId: testUserId,
        currentStop: randomStop.stop_id || randomStop.name,
        currentStopName: randomStop.name || `Stop ${i}`,
        joinedAt: Date.now(),
        lastActivity: Date.now()
      });
    }
  }
  
  // Trigger aggregation
  if (adapter instanceof MockRoomAdapter && adapter._aggregateRoomState) {
    adapter._aggregateRoomState(roomKey);
  }
  
  console.log(`[CSL Test] Added ${count} test contributors to room:`, roomKey);
}

/**
 * Simulate contributor updates (for testing)
 */
async function simulateContributorUpdate(roomKey, action = 'departed') {
  const adapter = window.CSL.getAdapter();
  const userId = await adapter.getUserId();
  const room = await adapter.getRoom(roomKey);
  
  if (!room) {
    console.error('[CSL Test] Room not found:', roomKey);
    return;
  }
  
  const stops = room.stops || [];
  if (stops.length === 0) {
    console.warn('[CSL Test] No stops available');
    return;
  }
  
  if (action === 'departed') {
    // Just mark as departed
    await adapter.updateContributor(roomKey, userId, {
      departed: true,
      departedAt: Date.now()
    });
    console.log('[CSL Test] Simulated "Departed"');
  } else if (action === 'arrived') {
    // Move to next stop
    const currentStopIdx = stops.findIndex(s => 
      (s.stop_id && s.stop_id === room.currentStop) || 
      s.name === room.currentStopName
    );
    if (currentStopIdx >= 0 && currentStopIdx < stops.length - 1) {
      const nextStop = stops[currentStopIdx + 1];
      await adapter.updateContributor(roomKey, userId, {
        currentStop: nextStop.stop_id || currentStopIdx + 1,
        currentStopName: nextStop.name,
        arrived: true,
        arrivedAt: Date.now()
      });
      console.log('[CSL Test] Simulated "Arrived" - moved to:', nextStop.name);
    } else {
      console.log('[CSL Test] Simulated "Arrived" - end of route');
    }
  } else if (action === 'late') {
    await adapter.updateContributor(roomKey, userId, {
      late: true,
      lateReportedAt: Date.now()
    });
    console.log('[CSL Test] Simulated "Running Late"');
  }
}

/**
 * List all active rooms (for testing)
 */
async function listActiveRooms() {
  const adapter = window.CSL.getAdapter();
  
  if (adapter instanceof MockRoomAdapter) {
    const rooms = Array.from(adapter.rooms.entries());
    console.log('[CSL Test] Active rooms:', rooms.length);
    rooms.forEach(([key, data]) => {
      console.log(`  - ${key}: ${data.contributors?.length || 0} contributors, confidence: ${data.confidence || 0}%`);
    });
    return rooms;
  } else {
    console.log('[CSL Test] Room listing not available for this adapter');
    return [];
  }
}

/**
 * Force cleanup expired rooms (for testing)
 */
function forceCleanup() {
  const adapter = window.CSL.getAdapter();
  if (adapter instanceof MockRoomAdapter && adapter.cleanup) {
    adapter.cleanup();
    console.log('[CSL Test] Forced cleanup executed');
  } else {
    console.log('[CSL Test] Cleanup not available for this adapter');
  }
}

/**
 * Set adapter mode (for testing)
 */
async function setAdapterMode(mode = 'mock') {
  if (mode === 'mock') {
    const newAdapter = new MockRoomAdapter();
    await newAdapter.initialize();
    window.CSL.setAdapter(newAdapter);
    console.log('[CSL Test] Switched to MockAdapter');
  } else if (mode === 'firebase') {
    console.log('[CSL Test] Firebase adapter not yet implemented');
    // TODO: When FirebaseRoomAdapter is ready
    // const newAdapter = new FirebaseRoomAdapter();
    // await newAdapter.initialize();
    // window.CSL.setAdapter(newAdapter);
  } else {
    console.error('[CSL Test] Unknown adapter mode:', mode);
  }
}

/**
 * Get current adapter info (for testing)
 */
function getAdapterInfo() {
  const adapter = window.CSL.getAdapter();
  return {
    type: adapter.constructor.name,
    isMock: adapter instanceof MockRoomAdapter,
    userId: adapter.userId || 'N/A'
  };
}

/**
 * Display all active CSL buses on the map (for all users to see)
 */
async function displayAllCSLBuses() {
  if (!window.map) {
    console.warn('[CSL] Map not available, cannot display buses');
    return;
  }
  
  const adapter = window.CSL.getAdapter();
  
  try {
    const activeRooms = await adapter.getAllActiveRooms();
    console.log(`[CSL] Displaying ${activeRooms.length} active CSL buses`);
    
    // Load route data and create markers for each room
    for (const { roomKey, roomData } of activeRooms) {
      // Skip if marker already exists
      if (cslState.busMarkers.has(roomKey)) {
        continue;
      }
      
      // Load route data
      let routeData = null;
      try {
        if (window.routeLoader) {
          routeData = await window.routeLoader.loadRoute(roomData.routeId, roomData.directionId);
        }
      } catch (e) {
        console.warn(`[CSL] Could not load route data for ${roomData.routeId}:`, e);
        continue;
      }
      
      // Create marker
      updateCSLBusMarker(roomKey, roomData, routeData);
    }
  } catch (e) {
    console.error('[CSL] Error displaying CSL buses:', e);
  }
}

/**
 * Initialize CSL bus display (call on page load)
 */
function initializeCSLBusDisplay() {
  // Display all CSL buses on load
  if (window.map) {
    displayAllCSLBuses();
  } else {
    // Wait for map to load
    if (window.addEventListener) {
      window.addEventListener('load', () => {
        setTimeout(() => displayAllCSLBuses(), 1000);
      });
    }
  }
  
  // Refresh CSL buses every 30 seconds
  setInterval(() => {
    displayAllCSLBuses();
  }, 30000);
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCSLBusDisplay);
} else {
  initializeCSLBusDisplay();
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
  showCSLBusModal,
  displayAllCSLBuses,
  initializeCSLBusDisplay,
  // Testing utilities
  test: {
    reset: resetCSLState,
    createRoom: createTestRoom,
    addContributors: addTestContributors,
    simulateUpdate: simulateContributorUpdate,
    listRooms: listActiveRooms,
    cleanup: forceCleanup,
    setAdapter: setAdapterMode,
    getAdapterInfo: getAdapterInfo
  }
};

// Log testing utilities to console
console.log('%c[CSL] Testing utilities available:', 'color: #1E90FF; font-weight: bold;');
console.log('  window.CSL.test.reset() - Reset CSL state');
console.log('  window.CSL.test.createRoom(routeId, directionId, busNumber, startingStop) - Create test room');
console.log('  window.CSL.test.addContributors(roomKey, count) - Add test contributors');
console.log('  window.CSL.test.simulateUpdate(roomKey, action) - Simulate update (departed/arrived/late)');
console.log('  window.CSL.test.listRooms() - List all active rooms');
console.log('  window.CSL.test.cleanup() - Force cleanup expired rooms');
console.log('  window.CSL.test.setAdapter(mode) - Switch adapter (mock/firebase)');
console.log('  window.CSL.test.getAdapterInfo() - Get current adapter info');

