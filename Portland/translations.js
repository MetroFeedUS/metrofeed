// MetroFeed Portland Translations
// Comprehensive translation system for portlandindex.html

console.log('🚀 translations.js is loading...');

// Global variables
let currentLanguage = 'en';

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
    "terms": "Terms of Use",
    "contact": "Contact Us",
    "report": "Report a Problem", 
    "dmca": "DMCA",
    "privacy": "Privacy Policy",
    
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
    "android_instructions": "Android Instructions",
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
    "termsOfUse": "Terms of Use",
    "contactUs": "Contact Us",
    "reportProblem": "Report a Problem",
    "privacyPolicy": "Privacy Policy",
    "cookieMessage": "📢 We use cookies to improve functionality and analyze traffic. By using MetroFeed, you agree to our",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Portland, OR - Bus Routes",
    "searchRoutes": "Search for a route...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Portland, OR - Rail Routes"
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
    "terms": "Términos de Uso",
    "contact": "Contáctenos",
    "report": "Reportar Problema",
    "dmca": "DMCA", 
    "privacy": "Política de Privacidad",
    
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
    "android_instructions": "Instrucciones Android",
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
    "termsOfUse": "Términos de Uso",
    "contactUs": "Contáctenos",
    "reportProblem": "Reportar Problema",
    "privacyPolicy": "Política de Privacidad",
    "cookieMessage": "📢 Usamos cookies para mejorar la funcionalidad y analizar el tráfico. Al usar MetroFeed, aceptas nuestra",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Portland, OR - Rutas de Autobús",
    "searchRoutes": "Buscar una ruta...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Portland, OR - Rutas de Tren",
    "disclaimer": "Esta herramienta no está afiliada ni respaldada por TriMet. Para horarios oficiales y alertas de servicio, visite"
  }
};

// Language management functions
function getCurrentLanguage() {
  // Check localStorage first
  const savedLang = localStorage.getItem('metrofeed_language');
  if (savedLang && translations[savedLang]) {
    return savedLang;
  }
  
  // Check browser language
  const browserLang = navigator.language || navigator.userLanguage;
  if (browserLang.startsWith('es')) {
    return 'es';
  }
  
  // Default to English
  return 'en';
}

function setLanguage(lang) {
  if (!translations[lang]) {
    console.warn(`Language '${lang}' not supported, falling back to English`);
    lang = 'en';
  }
  
  currentLanguage = lang;
  localStorage.setItem('metrofeed_language', lang);
  updatePageLanguage();
}

function updatePageLanguage() {
  console.log('updatePageLanguage called, current language:', currentLanguage);
  
  // Update HTML lang attribute
  document.documentElement.lang = currentLanguage;
  
  // Update page title
  document.title = translateText('page_title');
  
  // Update elements with data-translate attribute
  const translateElements = document.querySelectorAll('[data-translate]');
  console.log('Found', translateElements.length, 'elements with data-translate');
  translateElements.forEach(element => {
    const key = element.getAttribute('data-translate');
    const translation = translateText(key);
    if (translation) {
      element.textContent = translation;
    }
  });
  
  // Update elements with data-translate-placeholder attribute
  const placeholderElements = document.querySelectorAll('[data-translate-placeholder]');
  console.log('Found', placeholderElements.length, 'elements with data-translate-placeholder');
  placeholderElements.forEach(element => {
    const key = element.getAttribute('data-translate-placeholder');
    const translation = translateText(key);
    if (translation) {
      element.placeholder = translation;
    }
  });
  
  // Update language button text
  const langBtn = document.getElementById('languageBtn');
  if (langBtn) {
    const langSpan = langBtn.querySelector('span');
    if (langSpan) {
      langSpan.textContent = translateText('language');
      console.log('Updated language button text to:', translateText('language'));
    }
  } else {
    console.log('Language button not found');
  }
}

function translateText(key) {
  if (translations[currentLanguage] && translations[currentLanguage][key]) {
    return translations[currentLanguage][key];
  } else if (translations.en[key]) {
    return translations.en[key]; // Fallback to English
  }
  return key; // Return key if no translation found
}

function toggleLanguage() {
  console.log('toggleLanguage called, current language:', currentLanguage);
  const newLang = currentLanguage === 'en' ? 'es' : 'en';
  console.log('switching to:', newLang);
  setLanguage(newLang);
}

// Language dropdown functionality
function toggleLanguageDropdown() {
  const dropdown = document.getElementById('languageDropdown');
  if (dropdown) {
    const isVisible = dropdown.style.display === 'flex';
    dropdown.style.display = isVisible ? 'none' : 'flex';
    
    // Close dropdown when clicking outside
    if (!isVisible) {
      setTimeout(() => {
        document.addEventListener('click', closeLanguageDropdown);
      }, 100);
    }
  }
}

function closeLanguageDropdown(event) {
  const dropdown = document.getElementById('languageDropdown');
  const languageBtn = document.getElementById('languageBtn');
  
  if (dropdown && languageBtn) {
    if (!dropdown.contains(event.target) && !languageBtn.contains(event.target)) {
      dropdown.style.display = 'none';
      document.removeEventListener('click', closeLanguageDropdown);
    }
  }
}

function selectLanguage(lang) {
  // Only allow supported languages for now
  if (lang === 'en' || lang === 'es') {
    setLanguage(lang);
  } else {
    // For unsupported languages, show a message or just close dropdown
    console.log(`Language '${lang}' not yet supported`);
  }
  
  const dropdown = document.getElementById('languageDropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
    document.removeEventListener('click', closeLanguageDropdown);
  }
}

// Make all functions globally available
window.setLanguage = setLanguage;
window.updatePageLanguage = updatePageLanguage;
window.translateText = translateText;
window.getCurrentLanguage = getCurrentLanguage;
window.toggleLanguage = toggleLanguage;
window.toggleLanguageDropdown = toggleLanguageDropdown;
window.closeLanguageDropdown = closeLanguageDropdown;
window.selectLanguage = selectLanguage;

// Initialize language system
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOMContentLoaded - initializing language system');
  currentLanguage = getCurrentLanguage();
  console.log('Initial language set to:', currentLanguage);
  updatePageLanguage();
  
  // Test if the button exists
  const langBtn = document.getElementById('languageBtn');
  console.log('Language button found:', !!langBtn);
  if (langBtn) {
    console.log('Language button onclick:', langBtn.onclick);
  }
});

console.log('✅ translations.js loaded completely!'); 