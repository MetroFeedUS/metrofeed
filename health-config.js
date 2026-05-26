/**
 * RoamRaven Health Monitor - City Configuration
 *
 * Add a city by appending an object to HEALTH_CITIES.
 * Set any endpoint to null to skip that check.
 */
const HEALTH_CITIES = [
  {
    id: 'cincinnati',
    name: 'Cincinnati',
    baseUrl: 'https://roamravenapp.com/Cincinnati/',
    homeFile: 'home.html',
    routeIndex: 'routes_index.js',
    routeDataBase: 'route_data/',
    otpApi: 'https://otp.metrofeedus.com/cincinnati/otp/transmodel/v3',
    gtfsRtProxy: 'https://routes.metrofeedus.com/realtime/cincinnati/vehicles.json',
    realtimeAlerts: 'https://routes.metrofeedus.com/realtime/cincinnati/alerts.json',
    realtimeTrips: 'https://routes.metrofeedus.com/realtime/cincinnati/trips.json',
    trafficApi: 'https://traffic-api.metrofeedus.com/incidents/ohio',
    tileStyle: 'https://tiles.metrofeedus.com/styles/0/style.json',
    logo: 'MetroFeedMainLogo.png',
    maxDataAgeDays: 14
  }
];
