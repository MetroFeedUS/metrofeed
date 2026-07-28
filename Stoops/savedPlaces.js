/**
 * Saved places (Home / Work / custom) — coordinates in localStorage only.
 * Expects: window.map (MapLibre), maplibregl, #startInput / #endInput, window.translateText optional.
 */
(function () {
  const STORAGE_KEY = "metrofeedSavedPlacesV1";

  function T(key, en) {
    if (typeof window.translateText === "function") {
      const s = window.translateText(key);
      if (s && s !== key) return s;
    }
    return en;
  }

  function defaultData() {
    return { home: null, work: null, other: null };
  }

  function loadPlaces() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const p = JSON.parse(raw);
      return {
        home: p.home && typeof p.home.lat === "number" ? p.home : null,
        work: p.work && typeof p.work.lat === "number" ? p.work : null,
        other:
          p.other && typeof p.other.lat === "number"
            ? { lat: p.other.lat, lng: p.other.lng, label: String(p.other.label || "Place").slice(0, 24) }
            : null,
      };
    } catch (e) {
      return defaultData();
    }
  }

  function savePlaces(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("[savedPlaces] save failed", e);
    }
  }

  function coordDisplay(lat, lng) {
    return `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }

  let markers = { home: null, work: null, other: null };
  let pickState = null;
  let menuEl = null;
  let bannerEl = null;

  function removeBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  function endPick(cancelled) {
    removeBanner();
    if (pickState && pickState.draftMarker) {
      try {
        pickState.draftMarker.remove();
      } catch (e) {}
    }
    pickState = null;
    const m = window.map;
    if (m && m.getCanvas) m.getCanvas().style.cursor = "";
  }

  function makePinElement(slot, labelText) {
    const el = document.createElement("div");
    el.className = "saved-place-map-pin saved-place-map-pin--" + slot;
    const colors = { home: "#4CAF50", work: "#2196F3", other: "#FF9800" };
    el.style.cssText = [
      "width:28px",
      "height:28px",
      "border-radius:50%",
      "border:2px solid #fff",
      "background:" + (colors[slot] || "#888"),
      "color:#fff",
      "font-size:11px",
      "font-weight:bold",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "box-shadow:0 2px 8px rgba(0,0,0,0.45)",
      "cursor:pointer",
      "user-select:none",
    ].join(";");
    if (slot === "home") el.textContent = "H";
    else if (slot === "work") el.textContent = "W";
    else el.textContent = (labelText && labelText[0] ? labelText[0].toUpperCase() : "P");
    el.title = labelText || slot;
    return el;
  }

  function refreshMarkers() {
    const map = window.map;
    if (!map || typeof maplibregl === "undefined") return;
    const data = loadPlaces();
    ["home", "work", "other"].forEach((slot) => {
      if (markers[slot]) {
        try {
          markers[slot].remove();
        } catch (e) {}
        markers[slot] = null;
      }
      const pt = data[slot];
      if (!pt) return;
      const lng = pt.lng;
      const lat = pt.lat;
      if (typeof lat !== "number" || typeof lng !== "number") return;
      const pinLabel =
        slot === "other"
          ? pt.label || T("saved_place_other", "Place")
          : slot === "home"
            ? T("saved_place_home", "Home")
            : T("saved_place_work", "Work");
      const el = makePinElement(slot, pinLabel);
      const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markers[slot] = mk;
    });
  }

  function applyToStart(lat, lng) {
    const input = document.getElementById("startInput");
    if (input) input.value = coordDisplay(lat, lng);
    window.startCoords = { lat, lng };
    if (typeof window.pinStopOnMap === "function") {
      window.pinStopOnMap({ lat, lon: lng, name: coordDisplay(lat, lng) }, true);
    }
  }

  function applyToEnd(lat, lng) {
    const input = document.getElementById("endInput");
    if (input) input.value = coordDisplay(lat, lng);
    window.endCoords = { lat, lng };
    if (typeof window.pinStopOnMap === "function") {
      window.pinStopOnMap({ lat, lon: lng, name: coordDisplay(lat, lng) }, false);
    }
  }

  function centerMap(lat, lng) {
    const map = window.map;
    if (!map) return;
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }

  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    document.removeEventListener("click", onDocClickCloseMenu, true);
  }

  function onDocClickCloseMenu(e) {
    if (!menuEl) return;
    if (menuEl.contains(e.target)) return;
    closeMenu();
  }

  function openMenu(anchorEl, slot) {
    closeMenu();
    const data = loadPlaces();
    const pt = data[slot];
    if (!pt) return;

    const rect = anchorEl.getBoundingClientRect();
    const div = document.createElement("div");
    div.className = "saved-place-action-menu";
    div.style.cssText = [
      "position:fixed",
      "z-index:10060",
      "min-width:160px",
      "background:rgba(20,20,20,0.98)",
      "border:1px solid #1E90FF",
      "border-radius:8px",
      "padding:6px",
      "box-shadow:0 8px 24px rgba(0,0,0,0.5)",
      "font-family:system-ui,sans-serif",
      "font-size:13px",
    ].join(";");
    const top = Math.min(rect.bottom + 6, window.innerHeight - 200);
    const left = Math.min(rect.left, window.innerWidth - 180);
    div.style.top = top + "px";
    div.style.left = left + "px";

    function addItem(label, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "display:block;width:100%;text-align:left;padding:8px 10px;margin:2px 0;border:none;border-radius:6px;background:#222;color:#eee;cursor:pointer;font-size:12px;";
      b.onmouseenter = () => (b.style.background = "#333");
      b.onmouseleave = () => (b.style.background = "#222");
      b.onclick = (e) => {
        e.stopPropagation();
        closeMenu();
        fn();
      };
      div.appendChild(b);
    }

    const lat = pt.lat;
    const lng = pt.lng;

    addItem(T("saved_place_start_here", "Start here"), () => applyToStart(lat, lng));
    addItem(T("saved_place_go_here", "Go here"), () => applyToEnd(lat, lng));
    addItem(T("saved_place_center_map", "Center on map"), () => centerMap(lat, lng));
    addItem(T("saved_place_change", "Change location"), () => beginPick(slot));
    addItem(T("saved_place_remove", "Remove"), () => {
      if (!confirm(T("saved_place_remove_confirm", "Remove this saved place?"))) return;
      const next = loadPlaces();
      next[slot] = null;
      savePlaces(next);
      refreshMarkers();
      updatePlaceButtons();
    });

    document.body.appendChild(div);
    menuEl = div;
    setTimeout(() => document.addEventListener("click", onDocClickCloseMenu, true), 0);
  }

  function beginPick(slot) {
    if (typeof window.exitMapSelectionMode === "function") window.exitMapSelectionMode();
    endPick(true);

    pickState = { slot, draftMarker: null, pendingLat: null, pendingLng: null };

    const map = window.map;
    if (map && map.getCanvas) map.getCanvas().style.cursor = "crosshair";

    removeBanner();
    bannerEl = document.createElement("div");
    bannerEl.id = "savedPlacePickBanner";
    bannerEl.style.cssText = [
      "position:fixed",
      "bottom:120px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:10055",
      "max-width:min(420px,92vw)",
      "background:rgba(15,15,15,0.96)",
      "border:2px solid #1E90FF",
      "border-radius:10px",
      "padding:12px 14px",
      "text-align:center",
      "box-shadow:0 8px 28px rgba(0,0,0,0.55)",
    ].join(";");

    const msg = document.createElement("div");
    msg.style.cssText = "color:#fff;font-size:13px;line-height:1.4;margin-bottom:10px;";
    msg.textContent = T(
      "saved_place_pick_instructions",
      "Tap the map to place the pin. Tap Set to save, or Cancel."
    );
    bannerEl.appendChild(msg);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:center;flex-wrap:wrap;";

    const setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.textContent = T("saved_place_set", "Set");
    setBtn.style.cssText =
      "padding:8px 18px;border-radius:8px;border:none;background:#4CAF50;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;";
    setBtn.disabled = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = T("cancel", "Cancel");
    cancelBtn.style.cssText =
      "padding:8px 18px;border-radius:8px;border:none;background:#555;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;";
    cancelBtn.onclick = () => endPick(true);

    setBtn.onclick = () => {
      if (!pickState || pickState.pendingLat == null || pickState.pendingLng == null) return;
      let label = "";
      if (pickState.slot === "other") {
        label = window.prompt(T("saved_place_name_prompt", "Name this place (e.g. Gym)"), "Place");
        if (label === null) return;
        label = String(label || "Place").trim().slice(0, 24) || "Place";
      }
      const next = loadPlaces();
      const entry = { lat: pickState.pendingLat, lng: pickState.pendingLng };
      if (pickState.slot === "other") entry.label = label;
      next[pickState.slot] = entry;
      savePlaces(next);
      endPick(false);
      refreshMarkers();
      updatePlaceButtons();
      if (typeof window.updateItineraryBarPosition === "function") window.updateItineraryBarPosition();
    };

    row.appendChild(setBtn);
    row.appendChild(cancelBtn);
    bannerEl.appendChild(row);
    document.body.appendChild(bannerEl);

    pickState.setBtn = setBtn;
  }

  function updatePlaceButtons() {
    const data = loadPlaces();
    ["home", "work", "other"].forEach((slot) => {
      const btn = document.getElementById(
        slot === "home" ? "placeFavHome" : slot === "work" ? "placeFavWork" : "placeFavOther"
      );
      if (!btn) return;
      const pt = data[slot];
      btn.classList.toggle("place-favorite-empty", !pt);
      if (slot === "home") {
        btn.textContent = "H";
        btn.title = pt ? T("saved_place_home", "Home") : T("saved_place_set_home", "Set home");
      } else if (slot === "work") {
        btn.textContent = "W";
        btn.title = pt ? T("saved_place_work", "Work") : T("saved_place_set_work", "Set work");
      } else {
        btn.textContent = pt && pt.label ? pt.label[0].toUpperCase() : "+";
        btn.title = pt
          ? pt.label || T("saved_place_other", "Place")
          : T("saved_place_set_other", "Set a place");
      }
    });
  }

  function onPlaceButtonClick(slot, ev) {
    ev.stopPropagation();
    closeMenu();
    const data = loadPlaces();
    const pt = data[slot];
    if (!pt) {
      beginPick(slot);
      return;
    }
    openMenu(ev.currentTarget, slot);
  }

  window.metrofeedHandleSavedPlaceMapClick = function (e) {
    if (!pickState || !window.map) return false;
    const lat = e.lngLat.lat;
    const lng = e.lngLat.lng;
    pickState.pendingLat = lat;
    pickState.pendingLng = lng;
    if (pickState.setBtn) pickState.setBtn.disabled = false;

    if (!pickState.draftMarker) {
      const el = makePinElement(pickState.slot, pickState.slot === "other" ? "?" : pickState.slot);
      el.style.opacity = "0.85";
      pickState.draftMarker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat([lng, lat])
        .addTo(window.map);
    } else {
      pickState.draftMarker.setLngLat([lng, lat]);
    }
    return true;
  };

  window.metrofeedCancelSavedPlacePick = function () {
    endPick(true);
  };

  window.initMetrofeedSavedPlaces = function () {
    const map = window.map;
    if (!map) return;

    refreshMarkers();
    updatePlaceButtons();

    const h = document.getElementById("placeFavHome");
    const w = document.getElementById("placeFavWork");
    const o = document.getElementById("placeFavOther");
    if (h) h.onclick = (ev) => onPlaceButtonClick("home", ev);
    if (w) w.onclick = (ev) => onPlaceButtonClick("work", ev);
    if (o) o.onclick = (ev) => onPlaceButtonClick("other", ev);
  };

  window.refreshMetrofeedSavedPlaceMarkers = refreshMarkers;

  /** For OTP autocomplete — only slots that have coordinates. */
  window.metrofeedListSavedPlacesForPicker = function () {
    const data = loadPlaces();
    const out = [];
    if (data.home) {
      out.push({
        slot: "home",
        label: T("saved_place_home", "Home"),
        lat: data.home.lat,
        lng: data.home.lng,
        icon: "H",
      });
    }
    if (data.work) {
      out.push({
        slot: "work",
        label: T("saved_place_work", "Work"),
        lat: data.work.lat,
        lng: data.work.lng,
        icon: "W",
      });
    }
    if (data.other) {
      out.push({
        slot: "other",
        label: data.other.label || T("saved_place_other", "Place"),
        lat: data.other.lat,
        lng: data.other.lng,
        icon: data.other.label && data.other.label[0] ? data.other.label[0].toUpperCase() : "P",
      });
    }
    return out;
  };
})();
