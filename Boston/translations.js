// MetroFeed Portland Translations
// Comprehensive translation system for portlandindex.html

// Global variables
let currentLanguage = 'en';

// Define translations object first
const translations = {
  en: {
    // Page title
    "page_title": "MetroFeed Portland Map",
    
    // Search and UI
    "search_placeholder": "Search routes...",
    "start_location": "Start or Current Location", 
    "destination": "Destination",
    "find_me": "Find Me",
    "menu": "Menu",
    "account": "Account",
    "theme": "Theme",
    "ai_chat": "AI Chat",
    "language": "EN",
    
    // Beta banner
    "beta_test": "Beta Test",
    "beta_message": "This program is a beta test, please report any issues.",
    
    // Favorites
    "favorites": "Favorites",
    "favorite_routes": "Favorite Routes",
    "no_favorites": "No favorites yet",
    
    // Itinerary
    "itinerary": "Itinerary",
    "itinerary_details": "Click to view details",
    "restore": "Restore",
    
    // Footer
    "terms": "Terms",
    "contact": "Contact Us",
    "report": "Report a Problem", 
    "dmca": "DMCA",
    "privacy": "Privacy",
    
    // Popups and messages
    "live_bus": "Live Bus",
    "route": "Route",
    "direction": "Direction",
    "speed": "Speed",
    "block": "Block",
    "mph": "mph",
    "view_route_details": "View Route Details",
    "no_scheduled_times": "No scheduled times",
    
    // OTP related
    "from": "From",
    "to": "To",
    "departure": "Departure",
    "arrival": "Arrival",
    "duration": "Duration",
    "walking": "Walking",
    "transit": "Transit",
    "trip_options": "Trip Options",
    "depart_now": "Depart Now",
    "finding_route": "Finding closest route...",
    
    // Modal buttons
    "close": "Close",
    "cancel": "Cancel",
    "plan_trip": "Plan Trip",
    "go": "Go",
    "clear": "Clear",
    
    // Install prompt
    "androidInstructions": "Android Instructions",
    "android_instructions": "Android Instructions",
    "appleInstructions": "Apple Instructions",
    "apple_instructions": "Apple Instructions", 
    "later": "Later",
    "installPromptTitle": "📲 Add MetroFeed Portland to your home screen",
    "installPromptSubtitle": "Use MetroFeed like an app for faster access!",
    "doneDontAsk": "Done / Don't ask again",
    
    // Premium/Auth
    "sign_in_prompt": "Please sign in, sign up, or use the free version to continue:",
    "sign_in": "Sign In",
    "sign_up": "Sign Up",
    "use_free_version": "Use Free Version",
    "try_premium": "Try MetroFeed Premium FREE for 24hrs",
    "no_email_needed": "NO email needed",
    "start_free_trial": "Start Free Trial",
    
    // Error messages
    "error_loading": "Error loading data",
    "no_routes_found": "No routes found",
    "location_error": "Location error",
    
    // Data attribution
    "data_courtesy": "Data courtesy of TriMet.",
    "disclaimer": "This tool is not affiliated with or endorsed by TriMet. For official schedules and service alerts, visit",
    
    // PortlandHome specific
    "upgrade": "Upgrade",
    "betaDisclaimer": "⚠️ This is a Beta program, work in progress. Please REPORT bugs and pretend to be impressed.",
    "portlandDashboard": "Portland, OR Dashboard",
    "busRoutes": "Bus Routes",
    "railRoutes": "Rail Routes", 
    "trafficCams": "Traffic Cams",
    "weather": "Weather",
    "alerts": "Alerts",
    "earthquakes": "Earthquakes",
    "changeCity": "Change City",
    "termsOfUse": "Terms",
    "contactUs": "Contact Us",
    "reportProblem": "Report a Problem",
    "privacyPolicy": "Privacy",
    "cookieMessage": "📢 We use cookies to improve functionality and analyze traffic. By using MetroFeed, you agree to our",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Portland, OR - Bus Routes",
    "searchRoutes": "Search for a route...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Portland, OR - Rail Routes",
    
    // Weather page specific
    "weatherTitle": "Portland, OR Weather - MetroFeed",
    "weatherDisclaimerFull": "<strong>Disclaimer:</strong> MetroFeed is not an official source of emergency information. This site is for general awareness and entertainment purposes only. All weather data is sourced from the <a href=\"https://www.weather.gov\" target=\"_blank\" style=\"color: #1DA1F2; text-decoration: none;\">National Weather Service (NWS)</a>. During severe weather or life-threatening events, always rely on official alerts at <strong>weather.gov</strong> or your local authorities.",
    "weatherBetaMessage": "⚠️ This is a Beta program, work in progress. Please REPORT bugs and pretend to be impressed.",
    "weatherAlerts": "⚠️ Weather Alerts (Tap to View)",
    "checkingAlerts": "Checking for alerts...",
    "noActiveAlerts": "No active alerts for this area.",
    "unableToLoadAlerts": "⚠️ Unable to load alert data.",
    "jumpToForecast": "Jump to Forecast",
    "tornadoWarning": "Tornado Warning",
    "severeThunderstormWarning": "Severe Thunderstorm Warning",
    "flashFloodWarning": "Flash Flood Warning",
    "floodWarning": "Flood Warning",
    "winterStormWarning": "Winter Storm Warning",
    "specialWeatherStatement": "Special Weather Statement",
    "loadingForecast": "Loading 7-day forecast...",
    "loadingHourlyForecast": "Loading hourly forecast...",
    "sevenDayForecast": "7-Day Forecast",
    "weatherForecast": "Weather Forecast",
    "hourly": "Hourly",
    "currentConditions": "Current Conditions",
    "nextHours": "Next few hours",
    "noActiveWeatherAlerts": "No Active Weather Alerts",
    "viewDetails": "View Details",
    "viewOnWeatherGov": "View on weather.gov",
    "noHourlyData": "No hourly forecast data available",
    "failedToLoadHourly": "Failed to load hourly forecast",
    "unableToLoadWeatherAlerts": "Unable to load weather alerts. Please check weather.gov for official alerts.",
    "failedToLoadForecast": "Failed to load forecast.",
    "goBack": "Go back",
    "stop_times": "Stop Times",
    
    // Alerts page specific
    "alertsTitle": "Portland Alerts - MetroFeed",
    "portlandAreaAlerts": "Portland Area Alerts",
    "loadingAlerts": "Loading TriMet alerts…",
    "noActiveTriMetAlerts": "No active TriMet alerts.",
    "couldNotLoadAlerts": "Could not load TriMet alerts. Try again later.",
    "trimetAlert": "TriMet Alert",
    "fullAlert": "Full Alert →",
    
    // TrafficCameras page specific
    "trafficCamerasTitle": "Live Traffic Cameras – MetroFeed Portland",
    "liveTrafficCameras": "Live Traffic Cameras – Portland, OR",
    "cameraCourtesy": "Camera courtesy of ODOT",
    "cameraDisclaimer": "Camera images are still frames updated periodically and may not reflect real-time traffic. All images courtesy of the Oregon Department of Transportation (ODOT)."
  },
  
  es: {
    // Page title
    "page_title": "Mapa de MetroFeed Portland",
    
    // Search and UI
    "search_placeholder": "Buscar rutas...",
    "start_location": "Ubicación de inicio o actual",
    "destination": "Destino",
    "find_me": "Encontrar",
    "menu": "Menú",
    "account": "Cuenta",
    "theme": "Tema",
    "ai_chat": "Chat IA",
    "language": "ES",
    
    // Beta banner
    "beta_test": "Prueba Beta",
    "beta_message": "Este programa es una prueba beta, por favor reporte cualquier problema.",
    
    // Favorites
    "favorites": "Favoritos",
    "favorite_routes": "Rutas Favoritas",
    "no_favorites": "Sin favoritos aún",
    
    // Itinerary
    "itinerary": "Itinerario",
    "itinerary_details": "Haga clic para ver detalles",
    "restore": "Restaurar",
    
    // Footer
    "terms": "Términos",
    "contact": "Contáctenos",
    "report": "Reportar Problema",
    "dmca": "DMCA", 
    "privacy": "Privacidad",
    
    // Popups and messages
    "live_bus": "Autobús en Vivo",
    "route": "Ruta",
    "direction": "Dirección",
    "speed": "Velocidad",
    "block": "Bloque",
    "mph": "mph",
    "view_route_details": "Ver Detalles de Ruta",
    "no_scheduled_times": "Sin horarios programados",
    
    // OTP related
    "from": "Desde",
    "to": "Hacia",
    "departure": "Salida",
    "arrival": "Llegada",
    "duration": "Duración",
    "walking": "Caminando",
    "transit": "Tránsito",
    "trip_options": "Opciones de Viaje",
    "depart_now": "Salir Ahora",
    "finding_route": "Buscando ruta más cercana...",
    
    // Modal buttons
    "close": "Cerrar",
    "cancel": "Cancelar",
    "plan_trip": "Planificar Viaje",
    "go": "Ir",
    "clear": "Limpiar",
    
    // Install prompt
    "androidInstructions": "Instrucciones Android",
    "android_instructions": "Instrucciones Android",
    "appleInstructions": "Instrucciones Apple",
    "apple_instructions": "Instrucciones Apple",
    "later": "Más Tarde",
    "installPromptTitle": "📲 Agregar MetroFeed Portland a tu pantalla de inicio",
    "installPromptSubtitle": "¡Usa MetroFeed como una aplicación para acceso más rápido!",
    "doneDontAsk": "Listo / No preguntar de nuevo",
    
    // Premium/Auth
    "sign_in_prompt": "Por favor inicie sesión, regístrese o use la versión gratuita para continuar:",
    "sign_in": "Iniciar Sesión",
    "sign_up": "Registrarse",
    "use_free_version": "Usar Versión Gratuita",
    "try_premium": "Pruebe MetroFeed Premium GRATIS por 24 horas",
    "no_email_needed": "NO se necesita email",
    "start_free_trial": "Comenzar Prueba Gratuita",
    
    // Error messages
    "error_loading": "Error al cargar datos",
    "no_routes_found": "No se encontraron rutas",
    "location_error": "Error de ubicación",
    
    // Data attribution
    "data_courtesy": "Datos cortesía de TriMet.",
    
    // PortlandHome specific
    "upgrade": "Actualizar",
    "betaDisclaimer": "⚠️ Este es un programa Beta, trabajo en progreso. Por favor REPORTE errores y finja estar impresionado.",
    "portlandDashboard": "Panel de Portland, OR",
    "busRoutes": "Rutas de Autobús",
    "railRoutes": "Rutas de Tren",
    "trafficCams": "Cámaras de Tráfico",
    "weather": "Clima",
    "alerts": "Alertas",
    "earthquakes": "Terremotos",
    "changeCity": "Cambiar Ciudad",
    "termsOfUse": "Términos",
    "contactUs": "Contáctenos",
    "reportProblem": "Reportar Problema",
    "privacyPolicy": "Privacidad",
    "cookieMessage": "📢 Usamos cookies para mejorar la funcionalidad y analizar el tráfico. Al usar MetroFeed, aceptas nuestra",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Portland, OR - Rutas de Autobús",
    "searchRoutes": "Buscar una ruta...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Portland, OR - Rutas de Tren",
    "disclaimer": "Esta herramienta no está afiliada ni respaldada por TriMet. Para horarios oficiales y alertas de servicio, visite",
    
    // Weather page specific
    "weatherTitle": "Clima de Portland, OR - MetroFeed",
    "weatherDisclaimerFull": "<strong>Descargo de responsabilidad:</strong> MetroFeed no es una fuente oficial de información de emergencia. Este sitio es solo para conciencia general y entretenimiento. Todos los datos meteorológicos provienen del <a href=\"https://www.weather.gov\" target=\"_blank\" style=\"color: #1DA1F2; text-decoration: none;\">Servicio Meteorológico Nacional (NWS)</a>. Durante condiciones meteorológicas severas o eventos que amenacen la vida, siempre confíe en alertas oficiales en <strong>weather.gov</strong> o sus autoridades locales.",
    "weatherBetaMessage": "⚠️ Este es un programa Beta, trabajo en progreso. Por favor REPORTE errores y finja estar impresionado.",
    "weatherAlerts": "⚠️ Alertas Meteorológicas (Toca para Ver)",
    "checkingAlerts": "Verificando alertas...",
    "noActiveAlerts": "✅ No hay alertas activas en este momento.",
    "unableToLoadAlerts": "⚠️ No se pudieron cargar los datos de alerta.",
    "jumpToForecast": "Ir al Pronóstico",
    "tornadoWarning": "Advertencia de Tornado",
    "severeThunderstormWarning": "Advertencia de Tormenta Eléctrica Severa",
    "flashFloodWarning": "Advertencia de Inundación Repentina",
    "floodWarning": "Advertencia de Inundación",
    "winterStormWarning": "Advertencia de Tormenta Invernal",
    "specialWeatherStatement": "Declaración Meteorológica Especial",
    "loadingForecast": "Cargando pronóstico de 7 días...",
    "loadingHourlyForecast": "Cargando pronóstico por horas...",
    "sevenDayForecast": "Pronóstico de 7 Días",
    "weatherForecast": "Pronóstico del Tiempo",
    "hourly": "Por Horas",
    "currentConditions": "Condiciones Actuales",
    "nextHours": "Próximas Horas",
    "noActiveWeatherAlerts": "No Hay Alertas Meteorológicas Activas",
    "viewDetails": "Ver Detalles",
    "viewOnWeatherGov": "Ver en weather.gov",
    "noHourlyData": "No hay datos de pronóstico por horas disponibles",
    "failedToLoadHourly": "Error al cargar el pronóstico por horas",
    "failedToLoadForecast": "Error al cargar el pronóstico.",
    "goBack": "Volver",
    "stop_times": "Horarios de Parada",
    
    // Alerts page specific
    "alertsTitle": "Alertas de Portland - MetroFeed",
    "portlandAreaAlerts": "Alertas del Área de Portland",
    "loadingAlerts": "Cargando alertas de TriMet…",
    "noActiveTriMetAlerts": "No hay alertas activas de TriMet.",
    "couldNotLoadAlerts": "No se pudieron cargar las alertas de TriMet. Inténtalo más tarde.",
    "trimetAlert": "Alerta de TriMet",
    "fullAlert": "Alerta Completa →",
    
    // TrafficCameras page specific
    "trafficCamerasTitle": "Cámaras de Tráfico en Vivo – MetroFeed Portland",
    "liveTrafficCameras": "Cámaras de Tráfico en Vivo – Portland, OR",
    "cameraCourtesy": "Cámara cortesía de ODOT",
    "cameraDisclaimer": "Las imágenes de las cámaras son fotogramas fijos actualizados periódicamente y pueden no reflejar el tráfico en tiempo real. Todas las imágenes son cortesía del Departamento de Transporte de Oregon (ODOT)."
  }
};

// Translations object created

// Simple, direct functions
function getCurrentLanguage() {
  const savedLang = localStorage.getItem('metrofeed_language');
  if (savedLang && translations[savedLang]) {
    return savedLang;
  }
  const browserLang = navigator.language || navigator.userLanguage;
  if (browserLang.startsWith('es')) {
    return 'es';
  }
  return 'en';
}

function translateText(key) {
  // Verbose logging removed - was flooding console
  // console.log('🔍 translateText called with key:', key);
  // console.log('🔍 currentLanguage:', currentLanguage);
  // console.log('🔍 translations object exists:', !!translations);
  // console.log('🔍 translations[currentLanguage] exists:', !!translations[currentLanguage]);
  
  // Safety check - if translations object isn't loaded yet, return the key
  if (!translations || !translations[currentLanguage]) {
    // console.warn('❌ Translations not loaded yet, returning key:', key);
    return key;
  }
  
  if (translations[currentLanguage] && translations[currentLanguage][key]) {
    // console.log('✅ Found translation for', key, ':', translations[currentLanguage][key]);
    return translations[currentLanguage][key];
  } else if (translations.en && translations.en[key]) {
    // console.log('⚠️ Key not found in', currentLanguage, 'using English:', key);
    return translations.en[key];
  }
  console.warn('❌ Translation key not found:', key);
  return key;
}

function updatePageLanguage() {
  document.documentElement.lang = currentLanguage;
  
  // Only update title if there's a data-translate attribute on the title element
  const titleElement = document.querySelector('title[data-translate]');
  if (titleElement) {
    const titleKey = titleElement.getAttribute('data-translate');
    const titleTranslation = translateText(titleKey);
    document.title = titleTranslation;
  }
  
  const translateElements = document.querySelectorAll('[data-translate]');
  translateElements.forEach((element) => {
    const key = element.getAttribute('data-translate');
    const translation = translateText(key);
    if (translation) {
      // Check if this element should preserve HTML formatting
      const preserveHTML = element.hasAttribute('data-translate-html');
      if (preserveHTML) {
        element.innerHTML = translation;
      } else {
        element.textContent = translation;
      }
    }
  });
  
  const placeholderElements = document.querySelectorAll('[data-translate-placeholder]');
  placeholderElements.forEach(element => {
    const key = element.getAttribute('data-translate-placeholder');
    const translation = translateText(key);
    if (translation) {
      element.placeholder = translation;
    }
  });
}

function setLanguage(lang) {
  if (!translations[lang]) {
    lang = 'en';
  }
  currentLanguage = lang;
  localStorage.setItem('metrofeed_language', lang);
  updatePageLanguage();
}

// SIMPLE DROPDOWN FUNCTION - THIS IS ALL WE NEED
function toggleLanguageDropdown() {
  console.log('toggleLanguageDropdown called');
  const dropdown = document.getElementById('languageDropdown');
  if (dropdown) {
    if (dropdown.style.display === 'flex') {
      dropdown.style.display = 'none';
    } else {
      dropdown.style.display = 'flex';
    }
  }
}

function selectLanguage(lang) {
  if (lang === 'en' || lang === 'es') {
    setLanguage(lang);
  }
  const dropdown = document.getElementById('languageDropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
}

// Make functions globally available IMMEDIATELY
window.toggleLanguageDropdown = toggleLanguageDropdown;
window.selectLanguage = selectLanguage;
window.setLanguage = setLanguage;
window.updatePageLanguage = updatePageLanguage;
window.translateText = translateText;
window.getCurrentLanguage = getCurrentLanguage;

// Initialize currentLanguage immediately
currentLanguage = getCurrentLanguage();

// Test that the function is available

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  updatePageLanguage();
});

// translations.js loaded (v18) 