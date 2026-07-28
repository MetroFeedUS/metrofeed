// RoamRaven Cincinnati Translations
// English + Spanish for home.html (OTP, trip guide, footer, modals)

// Global variables
let currentLanguage = 'en';

// Define translations object first
const translations = {
  en: {
    // Page title
    "page_title": "RoamRaven Cincinnati Map",
    
    // Search and UI
    "search_placeholder": "Search routes...",
    "start_location": "Start",
    "destination": "Destination",
    "otp_input_focus_hint": "Type stop or use pin for map →",
    "use_my_location": "Use my location",
    "find_me": "Find Me",
    "menu": "Menu",
    "account": "Account",
    "theme": "Theme",
    "ai_chat": "Resources",
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
    "fav_route_tutorial_rail_note": "For the Cincinnati Streetcar or other rail lines, open Rail Routes from the menu and use the same star on a direction.",
    "fav_route_tutorial_never": "Don't show this again",
    "fav_route_tutorial_got_it": "Got it — pick a route",
    
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

    // Screen reader announcements (OTP)
    "sr_searching_trip_options": "Searching for trip options.",
    "sr_trip_options_loaded": "{count} trip options loaded.",
    "sr_no_trips_found": "No trips found.",
    "sr_otp_error_connecting": "Error connecting to trip planner server.",
    "sr_trip_options_opened": "Trip options opened.",
    "sr_trip_options_closed": "Trip options closed.",
    "sr_trip_settings_opened": "Trip options settings opened.",
    "sr_trip_settings_closed": "Trip options settings closed.",
    "sr_transfer_singular": "1 transfer",
    "sr_transfer_plural": "{count} transfers",
    "sr_route_selected": "Route selected: {mins} minute trip, {transfers}, starts at {start}, arrives at {end}.",
    "sr_route_selected_simple": "Route selected.",

    // Trip guide (visual text — primary path for deaf/HOH users)
    "trip_guide_title": "Trip guide",
    "trip_guide_start": "Start my trip",
    "trip_guide_resume": "Resume trip guide",
    "trip_guide_minimize": "Minimize trip guide",
    "trip_guide_exit": "Exit trip guide",
    "trip_guide_on_map": "Your trip is on the map. Tap <strong>{start}</strong> when you want step-by-step guidance.",
    "trip_guide_trip_ready": "Trip ready",
    "trip_guide_about_mins": "about {mins} min total",
    "trip_guide_transit_segments": "{count} transit segment(s). Tap <strong>{start}</strong> to begin.",
    "trip_guide_no_steps": "No steps available.",
    "tg_step_of": "Step {current} of {total}",
    "tg_back": "Back",
    "tg_next": "Next",
    "tg_done": "Done",
    "tg_at_stop_btn": "I'm at the stop",
    "tg_on_bus_btn": "I'm on the bus",
    "tg_off_bus_btn": "I'm off the bus",
    "tg_youre_close": "You're close.",
    "tg_walk_to": "Walk to {stop}",
    "tg_board_route": "Board Route {route}",
    "tg_toward": " toward {name}",
    "tg_get_off": "Get off at {stop}",
    "tg_distance": "Distance:",
    "tg_arrive_before": "Arrive before {time}",
    "tg_at": "At {stop}",
    "tg_board_around": "Board around {time}",
    "tg_arrive_around": "Arrive around {time}",
    "tg_cancel_confirm": "Are you sure you want to cancel your trip?",
    "ada_resources": "ADA & Official Resources",
    "otp_loading": "Loading trip options...",

    // Sponsor modal
    "sponsor_modal_title": "Thank You to Our Sponsor",
    "sponsor_modal_body": "Your support helps keep RoamRaven free for all users. We appreciate your partnership!",
    "sponsor_modal_visit": "Visit MetroFeed — metrofeedus.com",
    "sponsor_logo_alt": "MetroFeed sponsor — visit metrofeedus.com",

    // Resources page (ADA / official links)
    "resources_page_title": "ADA & Official Resources - RoamRaven",
    "resources_heading": "ADA & Official Resources",
    "resources_intro": "Official links and accessibility resources for RoamRaven users, including deaf and hard-of-hearing riders.",
    "resources_disclaimer": "RoamRaven is an independent service and is not affiliated with, endorsed by, or partnered with the organizations listed below. These links are provided for convenience and direct access to official information.",
    "resources_section_sorta": "SORTA/METRO",
    "resources_link_sorta_official": "SORTA/METRO Official Page",
    "resources_link_paratransit": "Paratransit Service",
    "resources_section_tank": "TANK",
    "resources_link_tank_official": "TANK Official Page",
    "resources_section_bcrta": "BCRTA",
    "resources_link_bcrta_official": "BCRTA Official Page",
    "resources_section_other": "Other",
    "resources_link_nws": "National Weather Service",
    "resources_link_ohgo": "OHGO — Traffic Data and Cameras",
    
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
    "installPromptTitle": "📲 Add RoamRaven to your home screen",
    "installPromptSubtitle": "Use RoamRaven like an app for faster access!",
    "doneDontAsk": "Done / Don't ask again",
    "install_prompt_subtitle": "Use RoamRaven like an app for faster access!",
    "done_dont_ask": "Done / Don't ask again",
    
    // Premium/Auth
    "sign_in_prompt": "Please sign in, sign up, or use the free version to continue:",
    "sign_in": "Sign In",
    "sign_up": "Sign Up",
    "use_free_version": "Use Free Version",
    "try_premium": "Try RoamRaven Premium FREE for 24hrs",
    "no_email_needed": "NO email needed",
    "start_free_trial": "Start Free Trial",
    
    // Error messages
    "error_loading": "Error loading data",
    "no_routes_found": "No routes found",
    "location_error": "Location error",
    
    // Data attribution
    "data_courtesy": "Data courtesy of SORTA, TANK, and BCRTA.",
    "disclaimer": "RoamRaven is not affiliated with or endorsed by local transit agencies. For official schedules and service alerts, visit",
    
    // PortlandHome specific
    "upgrade": "Upgrade",
    "betaDisclaimer": "⚠️ This is a Beta program, work in progress. Please REPORT bugs and pretend to be impressed.",
    "portlandDashboard": "Cincinnati, OH Dashboard",
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
    "cookieMessage": "📢 We use cookies to improve functionality and analyze traffic. By using RoamRaven, you agree to our",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Cincinnati, OH - Bus Routes",
    "searchRoutes": "Search for a route...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Cincinnati, OH - Rail Routes",
    
    // Weather page specific
    "weatherTitle": "Cincinnati, OH Weather - RoamRaven",
    "weatherDisclaimerFull": "<strong>Disclaimer:</strong> RoamRaven is not an official source of emergency information. This site is for general awareness and entertainment purposes only. All weather data is sourced from the <a href=\"https://www.weather.gov\" target=\"_blank\" style=\"color: #1DA1F2; text-decoration: none;\">National Weather Service (NWS)</a>. During severe weather or life-threatening events, always rely on official alerts at <strong>weather.gov</strong> or your local authorities.",
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
    "alertsTitle": "Cincinnati Alerts - RoamRaven",
    "portlandAreaAlerts": "Cincinnati Area Alerts",
    "loadingAlerts": "Loading transit alerts…",
    "noActiveTriMetAlerts": "No active transit alerts.",
    "couldNotLoadAlerts": "Could not load transit alerts. Try again later.",
    "trimetAlert": "Transit Alert",
    "fullAlert": "Full Alert →",
    
    // TrafficCameras page specific
    "trafficCamerasTitle": "Live Traffic Cameras – RoamRaven Cincinnati",
    "liveTrafficCameras": "Live Traffic Cameras – Cincinnati, OH",
    "cameraCourtesy": "Camera courtesy of OHGO",
    "cameraDisclaimer": "Camera images are still frames updated periodically and may not reflect real-time traffic. All images courtesy of OHGO.",

    // Spanish WIP notice (shown when ES is selected)
    "esWipNoticeTitle": "Spanish / Español",
    "esWipNoticeBody": "Spanish is a work in progress.\n\nSome parts of RoamRaven may still appear in English, and some translations may be incomplete or inaccurate.\n\nThe English version is the official version of RoamRaven.\n\nWe appreciate your feedback as we continue improving the Spanish experience.",
    "esWipNoticeBodyEs": "El español es un trabajo en progreso.\n\nAlgunas partes de RoamRaven pueden seguir apareciendo en inglés, y algunas traducciones pueden estar incompletas o ser inexactas.\n\nLa versión en inglés es la versión oficial de RoamRaven.\n\nAgradecemos tus comentarios mientras seguimos mejorando la experiencia en español.",
    "esWipNoticeOk": "Got it / Entendido"
  },
  
  es: {
    // Page title
    "page_title": "Mapa de RoamRaven Cincinnati",
    
    // Search and UI
    "search_placeholder": "Buscar rutas...",
    "start_location": "Inicio",
    "destination": "Destino",
    "otp_input_focus_hint": "Escribe parada o usa el pin en el mapa →",
    "use_my_location": "Usar mi ubicación",
    "find_me": "Encontrar",
    "menu": "Menú",
    "account": "Cuenta",
    "theme": "Tema",
    "ai_chat": "Recursos",
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
    "fav_route_tutorial_rail_note": "Para el tranvía de Cincinnati u otras líneas de tren, abre Rutas de tren en el menú y usa la misma estrella en una dirección.",
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

    // Screen reader announcements (OTP)
    "sr_searching_trip_options": "Buscando opciones de viaje.",
    "sr_trip_options_loaded": "{count} opciones de viaje cargadas.",
    "sr_no_trips_found": "No se encontraron viajes.",
    "sr_otp_error_connecting": "Error al conectar con el servidor del planificador de viajes.",
    "sr_trip_options_opened": "Opciones de viaje abiertas.",
    "sr_trip_options_closed": "Opciones de viaje cerradas.",
    "sr_trip_settings_opened": "Configuración de opciones de viaje abierta.",
    "sr_trip_settings_closed": "Configuración de opciones de viaje cerrada.",
    "sr_transfer_singular": "1 transbordo",
    "sr_transfer_plural": "{count} transbordos",
    "sr_route_selected": "Ruta seleccionada: viaje de {mins} minutos, {transfers}, sale a las {start}, llega a las {end}.",
    "sr_route_selected_simple": "Ruta seleccionada.",

    // Trip guide (visual text — primary path for deaf/HOH users)
    "trip_guide_title": "Guía del viaje",
    "trip_guide_start": "Iniciar mi viaje",
    "trip_guide_resume": "Reanudar guía del viaje",
    "trip_guide_minimize": "Minimizar guía del viaje",
    "trip_guide_exit": "Salir de la guía del viaje",
    "trip_guide_on_map": "Tu viaje está en el mapa. Toca <strong>{start}</strong> cuando quieras orientación paso a paso.",
    "trip_guide_trip_ready": "Viaje listo",
    "trip_guide_about_mins": "aprox. {mins} min en total",
    "trip_guide_transit_segments": "{count} tramo(s) de tránsito. Toca <strong>{start}</strong> para comenzar.",
    "trip_guide_no_steps": "No hay pasos disponibles.",
    "tg_step_of": "Paso {current} de {total}",
    "tg_back": "Atrás",
    "tg_next": "Siguiente",
    "tg_done": "Listo",
    "tg_at_stop_btn": "Estoy en la parada",
    "tg_on_bus_btn": "Estoy en el autobús",
    "tg_off_bus_btn": "Bajé del autobús",
    "tg_youre_close": "Estás cerca.",
    "tg_walk_to": "Camina a {stop}",
    "tg_board_route": "Sube a la Ruta {route}",
    "tg_toward": " hacia {name}",
    "tg_get_off": "Baja en {stop}",
    "tg_distance": "Distancia:",
    "tg_arrive_before": "Llega antes de las {time}",
    "tg_at": "En {stop}",
    "tg_board_around": "Sube alrededor de las {time}",
    "tg_arrive_around": "Llega alrededor de las {time}",
    "tg_cancel_confirm": "¿Seguro que quieres cancelar tu viaje?",
    "ada_resources": "ADA y Recursos Oficiales",
    "otp_loading": "Cargando opciones de viaje...",

    // Sponsor modal
    "sponsor_modal_title": "Gracias a Nuestro Patrocinador",
    "sponsor_modal_body": "Su apoyo ayuda a mantener RoamRaven gratis para todos los usuarios. ¡Agradecemos su colaboración!",
    "sponsor_modal_visit": "Visitar MetroFeed — metrofeedus.com",
    "sponsor_logo_alt": "Patrocinador MetroFeed — visite metrofeedus.com",

    // Resources page (ADA / official links)
    "resources_page_title": "ADA y Recursos Oficiales - RoamRaven",
    "resources_heading": "ADA y Recursos Oficiales",
    "resources_intro": "Enlaces oficiales y recursos de accesibilidad para usuarios de RoamRaven, incluidos pasajeros sordos o con dificultad auditiva.",
    "resources_disclaimer": "RoamRaven es un servicio independiente y no está afiliado, respaldado ni asociado con las organizaciones que se enumeran a continuación. Estos enlaces se ofrecen por conveniencia y acceso directo a información oficial.",
    "resources_section_sorta": "SORTA/METRO",
    "resources_link_sorta_official": "Página oficial de SORTA/METRO",
    "resources_link_paratransit": "Servicio de paratransporte",
    "resources_section_tank": "TANK",
    "resources_link_tank_official": "Página oficial de TANK",
    "resources_section_bcrta": "BCRTA",
    "resources_link_bcrta_official": "Página oficial de BCRTA",
    "resources_section_other": "Otros",
    "resources_link_nws": "Servicio Meteorológico Nacional",
    "resources_link_ohgo": "OHGO — Datos de tráfico y cámaras",
    
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
    "installPromptTitle": "📲 Agregar RoamRaven a tu pantalla de inicio",
    "installPromptSubtitle": "¡Usa RoamRaven como una aplicación para acceso más rápido!",
    "doneDontAsk": "Listo / No preguntar de nuevo",
    "install_prompt_subtitle": "¡Usa RoamRaven como una aplicación para acceso más rápido!",
    "done_dont_ask": "Listo / No preguntar de nuevo",
    
    // Premium/Auth
    "sign_in_prompt": "Por favor inicie sesión, regístrese o use la versión gratuita para continuar:",
    "sign_in": "Iniciar Sesión",
    "sign_up": "Registrarse",
    "use_free_version": "Usar Versión Gratuita",
    "try_premium": "Pruebe RoamRaven Premium GRATIS por 24 horas",
    "no_email_needed": "NO se necesita email",
    "start_free_trial": "Comenzar Prueba Gratuita",
    
    // Error messages
    "error_loading": "Error al cargar datos",
    "no_routes_found": "No se encontraron rutas",
    "location_error": "Error de ubicación",
    
    // Data attribution
    "data_courtesy": "Datos cortesía de SORTA, TANK y BCRTA.",
    
    // PortlandHome specific
    "upgrade": "Actualizar",
    "betaDisclaimer": "⚠️ Este es un programa Beta, trabajo en progreso. Por favor REPORTE errores y finja estar impresionado.",
    "portlandDashboard": "Panel de Cincinnati, OH",
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
    "cookieMessage": "📢 Usamos cookies para mejorar la funcionalidad y analizar el tráfico. Al usar RoamRaven, aceptas nuestra",
    "ok": "OK",
    
    // BusRoutesMain specific
    "portlandBusRoutes": "Cincinnati, OH - Rutas de Autobús",
    "searchRoutes": "Buscar una ruta...",
    
    // RailRoutes specific
    "portlandRailRoutes": "Cincinnati, OH - Rutas de Tren",
    "disclaimer": "RoamRaven no está afiliado ni respaldado por las agencias de tránsito locales. Para horarios oficiales y alertas de servicio, visite",
    
    // Weather page specific
    "weatherTitle": "Clima de Cincinnati, OH - RoamRaven",
    "weatherDisclaimerFull": "<strong>Descargo de responsabilidad:</strong> RoamRaven no es una fuente oficial de información de emergencia. Este sitio es solo para conciencia general y entretenimiento. Todos los datos meteorológicos provienen del <a href=\"https://www.weather.gov\" target=\"_blank\" style=\"color: #1DA1F2; text-decoration: none;\">Servicio Meteorológico Nacional (NWS)</a>. Durante condiciones meteorológicas severas o eventos que amenacen la vida, siempre confíe en alertas oficiales en <strong>weather.gov</strong> o sus autoridades locales.",
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
    "alertsTitle": "Alertas de Cincinnati - RoamRaven",
    "portlandAreaAlerts": "Alertas del Área de Cincinnati",
    "loadingAlerts": "Cargando alertas de tránsito…",
    "noActiveTriMetAlerts": "No hay alertas activas de tránsito.",
    "couldNotLoadAlerts": "No se pudieron cargar las alertas de tránsito. Inténtalo más tarde.",
    "trimetAlert": "Alerta de tránsito",
    "fullAlert": "Alerta Completa →",
    
    // TrafficCameras page specific
    "trafficCamerasTitle": "Cámaras de Tráfico en Vivo – RoamRaven Cincinnati",
    "liveTrafficCameras": "Cámaras de Tráfico en Vivo – Cincinnati, OH",
    "cameraCourtesy": "Cámara cortesía de OHGO",
    "cameraDisclaimer": "Las imágenes de las cámaras son fotogramas fijos actualizados periódicamente y pueden no reflejar el tráfico en tiempo real. Todas las imágenes son cortesía de OHGO.",

    // Spanish WIP notice (shown when ES is selected)
    "esWipNoticeTitle": "Spanish / Español",
    "esWipNoticeBody": "Spanish is a work in progress.\n\nSome parts of RoamRaven may still appear in English, and some translations may be incomplete or inaccurate.\n\nThe English version is the official version of RoamRaven.\n\nWe appreciate your feedback as we continue improving the Spanish experience.",
    "esWipNoticeBodyEs": "El español es un trabajo en progreso.\n\nAlgunas partes de RoamRaven pueden seguir apareciendo en inglés, y algunas traducciones pueden estar incompletas o ser inexactas.\n\nLa versión en inglés es la versión oficial de RoamRaven.\n\nAgradecemos tus comentarios mientras seguimos mejorando la experiencia en español.",
    "esWipNoticeOk": "Got it / Entendido"
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
  if (!translations || !translations[currentLanguage]) {
    return key;
  }
  
  if (translations[currentLanguage] && translations[currentLanguage][key]) {
    return translations[currentLanguage][key];
  } else if (translations.en && translations.en[key]) {
    return translations.en[key];
  }
  
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
  
  document.querySelectorAll('[data-translate-aria]').forEach((element) => {
    const key = element.getAttribute('data-translate-aria');
    const translation = translateText(key);
    if (translation) element.setAttribute('aria-label', translation);
  });
  document.querySelectorAll('[data-translate-alt]').forEach((element) => {
    const key = element.getAttribute('data-translate-alt');
    const translation = translateText(key);
    if (translation) element.setAttribute('alt', translation);
  });
  document.querySelectorAll('[data-translate-title]').forEach((element) => {
    const key = element.getAttribute('data-translate-title');
    const translation = translateText(key);
    if (translation) {
      element.setAttribute('title', translation);
      element.setAttribute('aria-label', translation);
    }
  });

  const placeholderElements = document.querySelectorAll('[data-translate-placeholder]');
  placeholderElements.forEach(element => {
    const key = element.getAttribute('data-translate-placeholder');
    const translation = translateText(key);
    if (translation) {
      element.dataset.mfPlaceholderIdle = translation;
      const focusKey = element.getAttribute('data-translate-placeholder-focus');
      const focusHint = focusKey ? translateText(focusKey) : '';
      if (focusHint) element.dataset.mfPlaceholderFocus = focusHint;
      const focusedEmpty = document.activeElement === element && !element.value.trim();
      element.placeholder = (focusedEmpty && focusHint) ? focusHint : translation;
    }
  });

  // Refresh dynamic UI (trip guide button text, step panel, ADA menu label)
  try {
    const adaBtn = document.getElementById('dropdownAiChatBtn');
    if (adaBtn) adaBtn.setAttribute('aria-label', translateText('ada_resources'));
    if (typeof window.mfSetTripStarted === 'function') {
      const tripBtn = document.getElementById('mfTripGuideStartBtn');
      if (tripBtn) window.mfSetTripStarted(tripBtn.getAttribute('data-trip-started') === 'true');
    }
    if (typeof window.mfTripGuideRender === 'function') window.mfTripGuideRender();
  } catch (_) {}
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

// Test that the function is available

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  updatePageLanguage();
});

// translations.js loaded (v24 Cincinnati)