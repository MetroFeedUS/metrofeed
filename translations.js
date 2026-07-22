// MetroFeed Portland Translations
// Comprehensive translation system for portlandindex.html

console.log('🚀 translations.js is loading...');

// Global variables
let currentLanguage = 'en';

// Define translations object first
console.log('🔍 Creating translations object...');
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
    "saved_place_home": "Home",
    "saved_place_work": "Work",
    "saved_place_other": "Place",
    "saved_place_set_home": "Set home",
    "saved_place_set_work": "Set work",
    "saved_place_set_other": "Set a place",
    "saved_place_pick_instructions": "Tap the map to place the pin. Tap Set to save, or Cancel.",
    "saved_place_set": "Set",
    "saved_place_start_here": "Start here",
    "saved_place_go_here": "Go here",
    "saved_place_center_map": "Center on map",
    "saved_place_change": "Change location",
    "saved_place_remove": "Remove",
    "saved_place_remove_confirm": "Remove this saved place?",
    "saved_place_name_prompt": "Name this place (e.g. Gym)",
    "fav_route_tutorial_title": "Save a favorite route",
    "fav_route_tutorial_body": "Open a route, choose a direction, then tap the star next to that direction to save it here. You need both the route and the direction.",
    "fav_route_tutorial_rail_note": "For subway or commuter rail, open Rail Routes from the menu and use the same star on a direction.",
    "fav_route_tutorial_never": "Don't show this again",
    "fav_route_tutorial_got_it": "Got it — pick a route",
    
    // Itinerary
    "itinerary": "Itinerary",
    "itinerary_details": "Click to view details",
    "restore": "Restore",
    
    // Footer
    "terms": "Terms", // UPDATED v15 - Shortened from "Terms of Use"
    "contact": "Contact Us",
    "report": "Report a Problem", 
    "dmca": "DMCA",
    "privacy": "Privacy", // UPDATED v15 - Shortened from "Privacy Policy"
    
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
    "appleInstructions": "Apple Instructions", 
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
    "noActiveAlerts": "✅ No active alerts at this time.",
    "unableToLoadAlerts": "⚠️ Unable to load alert data.",
    "jumpToForecast": "Jump to Forecast",
    "tornadoWarning": "Tornado Warning",
    "severeThunderstormWarning": "Severe Thunderstorm Warning",
    "flashFloodWarning": "Flash Flood Warning",
    "floodWarning": "Flood Warning",
    "winterStormWarning": "Winter Storm Warning",
    "specialWeatherStatement": "Special Weather Statement",
    "loadingForecast": "Loading 7-day forecast...",
    "sevenDayForecast": "7-Day Forecast",
    "failedToLoadForecast": "Failed to load forecast.",
    "goBack": "Go back",
    
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
    "cameraDisclaimer": "Camera images are still frames updated periodically and may not reflect real-time traffic. All images courtesy of the Oregon Department of Transportation (ODOT).",

    // Spanish WIP notice (shown when ES is selected)
    "esWipNoticeTitle": "Spanish / Español",
    "esWipNoticeBody": "Spanish is a work in progress.\n\nSome parts of RoamRaven may still appear in English, and some translations may be incomplete or inaccurate.\n\nThe English version is the official version of RoamRaven.\n\nWe appreciate your feedback as we continue improving the Spanish experience.",
    "esWipNoticeBodyEs": "El español es un trabajo en progreso.\n\nAlgunas partes de RoamRaven pueden seguir apareciendo en inglés, y algunas traducciones pueden estar incompletas o ser inexactas.\n\nLa versión en inglés es la versión oficial de RoamRaven.\n\nAgradecemos tus comentarios mientras seguimos mejorando la experiencia en español.",
    "esWipNoticeOk": "Got it / Entendido"
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
    "saved_place_home": "Casa",
    "saved_place_work": "Trabajo",
    "saved_place_other": "Lugar",
    "saved_place_set_home": "Definir casa",
    "saved_place_set_work": "Definir trabajo",
    "saved_place_set_other": "Definir un lugar",
    "saved_place_pick_instructions": "Toca el mapa para colocar el pin. Pulsa Guardar para confirmar o Cancelar.",
    "saved_place_set": "Guardar",
    "saved_place_start_here": "Inicio aquí",
    "saved_place_go_here": "Destino aquí",
    "saved_place_center_map": "Centrar mapa",
    "saved_place_change": "Cambiar ubicación",
    "saved_place_remove": "Quitar",
    "saved_place_remove_confirm": "¿Quitar este lugar guardado?",
    "saved_place_name_prompt": "Nombre del lugar (ej. Gimnasio)",
    "fav_route_tutorial_title": "Guardar una ruta favorita",
    "fav_route_tutorial_body": "Abre una ruta, elige una dirección y toca la estrella junto a esa dirección para guardarla aquí. Necesitas la ruta y la dirección.",
    "fav_route_tutorial_rail_note": "Para metro o cercanías, abre Rutas de tren en el menú y usa la misma estrella en una dirección.",
    "fav_route_tutorial_never": "No volver a mostrar",
    "fav_route_tutorial_got_it": "Entendido — elegir ruta",
    
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
    "appleInstructions": "Instrucciones Apple",
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
    "sevenDayForecast": "Pronóstico de 7 Días",
    "failedToLoadForecast": "Error al cargar el pronóstico.",
    "goBack": "Volver",
    
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
    "cameraDisclaimer": "Las imágenes de las cámaras son fotogramas fijos actualizados periódicamente y pueden no reflejar el tráfico en tiempo real. Todas las imágenes son cortesía del Departamento de Transporte de Oregon (ODOT).",

    // Spanish WIP notice (shown when ES is selected)
    "esWipNoticeTitle": "Spanish / Español",
    "esWipNoticeBody": "Spanish is a work in progress.\n\nSome parts of RoamRaven may still appear in English, and some translations may be incomplete or inaccurate.\n\nThe English version is the official version of RoamRaven.\n\nWe appreciate your feedback as we continue improving the Spanish experience.",
    "esWipNoticeBodyEs": "El español es un trabajo en progreso.\n\nAlgunas partes de RoamRaven pueden seguir apareciendo en inglés, y algunas traducciones pueden estar incompletas o ser inexactas.\n\nLa versión en inglés es la versión oficial de RoamRaven.\n\nAgradecemos tus comentarios mientras seguimos mejorando la experiencia en español.",
    "esWipNoticeOk": "Got it / Entendido"
  }
};

console.log('🔍 Translations object created with EN keys:', Object.keys(translations.en).length);
console.log('🔍 Translations object created with ES keys:', Object.keys(translations.es).length);
console.log('🔍 Weather keys in EN:', Object.keys(translations.en).filter(key => key.includes('weather')));
console.log('🔍 Weather keys in ES:', Object.keys(translations.es).filter(key => key.includes('weather')));

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
  console.log('🔍 translateText called with key:', key);
  console.log('🔍 currentLanguage:', currentLanguage);
  console.log('🔍 translations object exists:', !!translations);
  console.log('🔍 translations[currentLanguage] exists:', !!translations[currentLanguage]);
  
  // Safety check - if translations object isn't loaded yet, return the key
  if (!translations || !translations[currentLanguage]) {
    console.warn('❌ Translations not loaded yet, returning key:', key);
    return key;
  }
  
  if (translations[currentLanguage] && translations[currentLanguage][key]) {
    const translation = translations[currentLanguage][key];
    console.log('✅ Found translation for', key, ':', translation);
    // Debug footer translations
    if (key === 'terms' || key === 'privacy') {
      console.log('🔍 FOOTER DEBUG - Key:', key, 'Translation:', translation, 'Current lang:', currentLanguage);
    }
    return translation;
  } else if (translations.en && translations.en[key]) {
    console.log('⚠️ Key not found in', currentLanguage, 'using English:', key);
    return translations.en[key];
  }
  console.warn('❌ Translation key not found:', key);
  return key;
}

function updatePageLanguage() {
  console.log('🔄 updatePageLanguage called, currentLanguage:', currentLanguage);
  console.log('🔄 Document readyState:', document.readyState);
  console.log('🔄 translations object available:', typeof translations);
  document.documentElement.lang = currentLanguage;
  
  // Only update title if there's a data-translate attribute on the title element
  const titleElement = document.querySelector('title[data-translate]');
  console.log('🔄 Title element found:', !!titleElement);
  if (titleElement) {
    const titleKey = titleElement.getAttribute('data-translate');
    console.log('🔄 Title key:', titleKey);
    const titleTranslation = translateText(titleKey);
    console.log('🔄 Title translation:', titleTranslation);
    document.title = titleTranslation;
  }
  
  const translateElements = document.querySelectorAll('[data-translate]');
  console.log('📝 Found', translateElements.length, 'elements to translate');
  translateElements.forEach((element, index) => {
    const key = element.getAttribute('data-translate');
    console.log(`🔍 Processing element ${index + 1}/${translateElements.length} with key:`, key);
    console.log('🔍 Element tagName:', element.tagName);
    console.log('🔍 Element original text:', element.textContent);
    const translation = translateText(key);
    console.log('📄 Translation result:', translation);
    if (translation && translation !== key) {
      // Check if this element should preserve HTML formatting
      const preserveHTML = element.hasAttribute('data-translate-html');
      console.log('🔍 Preserve HTML:', preserveHTML);
      if (preserveHTML) {
        console.log('🔍 Setting innerHTML to:', translation);
        element.innerHTML = translation;
      } else {
        // Special handling for footer links - ALWAYS use short version
        if (key === 'terms' || key === 'privacy') {
          // Force short version regardless of what translation says
          const shortVersion = key === 'terms' ? 'Terms' : 'Privacy';
          const spanishVersion = key === 'terms' ? 'Términos' : 'Privacidad';
          element.textContent = currentLanguage === 'es' ? spanishVersion : shortVersion;
          console.log('✅ Forced short footer text for:', key, '=', element.textContent);
          return;
        }
        element.textContent = translation;
      }
      console.log('✅ Applied translation to element');
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

function showSpanishWipNotice() {
  try {
    if (sessionStorage.getItem('metrofeed_es_wip_notice_shown') === '1') return;
    if (document.getElementById('mfEsWipNotice')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mfEsWipNotice';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mfEsWipNoticeTitle');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;' +
      'padding:16px;box-sizing:border-box;background:rgba(0,0,0,0.55);';

    const card = document.createElement('div');
    card.style.cssText =
      'max-width:420px;width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:10px;' +
      'padding:1.1rem 1.2rem;box-shadow:0 12px 40px rgba(0,0,0,0.45);font-family:inherit;';

    const title = document.createElement('div');
    title.id = 'mfEsWipNoticeTitle';
    title.style.cssText = 'font-weight:700;font-size:1.05rem;margin-bottom:0.75rem;color:#fff;';
    title.textContent = translations.en.esWipNoticeTitle || 'Spanish / Español';

    const bodyEn = document.createElement('p');
    bodyEn.style.cssText = 'margin:0 0 0.75rem;font-size:0.92rem;line-height:1.45;color:#ddd;white-space:pre-line;';
    bodyEn.textContent = translations.en.esWipNoticeBody || translateText('esWipNoticeBody');

    const bodyEs = document.createElement('p');
    bodyEs.style.cssText = 'margin:0 0 1rem;font-size:0.92rem;line-height:1.45;color:#bbb;white-space:pre-line;';
    bodyEs.textContent = translations.es.esWipNoticeBodyEs || translations.en.esWipNoticeBodyEs || '';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.style.cssText =
      'width:100%;padding:0.65rem 1rem;border:none;border-radius:8px;cursor:pointer;' +
      'background:var(--rr-accent,#9333ea);color:#fff;font-weight:700;font-size:0.95rem;';
    okBtn.textContent = translations.en.esWipNoticeOk || 'Got it / Entendido';

    const dismiss = () => {
      try {
        sessionStorage.setItem('metrofeed_es_wip_notice_shown', '1');
      } catch (_) {}
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    okBtn.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });

    card.appendChild(title);
    card.appendChild(bodyEn);
    card.appendChild(bodyEs);
    card.appendChild(okBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  } catch (_) {}
}

function setLanguage(lang) {
  if (!translations[lang]) {
    lang = 'en';
  }
  const previous = currentLanguage;
  currentLanguage = lang;
  localStorage.setItem('metrofeed_language', lang);
  updatePageLanguage();
  if (lang === 'es' && previous !== 'es') {
    showSpanishWipNotice();
  }
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
console.log('🌍 Current language set to:', currentLanguage);

// Test that the function is available
console.log('toggleLanguageDropdown available:', typeof window.toggleLanguageDropdown);

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  updatePageLanguage();
});

console.log('✅ translations.js loaded completely! (v15)');
console.log('🔍 FOOTER VERIFICATION - terms:', translations.en.terms, 'privacy:', translations.en.privacy);
console.log('🔍 FOOTER VERIFICATION ES - terms:', translations.es.terms, 'privacy:', translations.es.privacy); 