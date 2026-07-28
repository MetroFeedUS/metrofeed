/**
 * RoamRaven TV — OBS auth helper.
 * OBS gives each browser source its own sessionStorage, so use localStorage
 * (shared across sources on the same machine/profile).
 */
(function () {
  'use strict';

  var AUTH_KEY = 'obsTvAuth';

  function isAuthed() {
    try {
      if (localStorage.getItem(AUTH_KEY) === '1') return true;
    } catch (_) {}
    try {
      if (sessionStorage.getItem(AUTH_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function setAuthed() {
    try {
      localStorage.setItem(AUTH_KEY, '1');
    } catch (_) {}
    try {
      sessionStorage.setItem(AUTH_KEY, '1');
    } catch (_) {}
  }

  window.mfObsTvIsAuthed = isAuthed;
  window.mfObsTvSetAuthed = setAuthed;
})();
