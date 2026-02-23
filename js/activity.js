/**
 * activity.js — Activity logging module for Intel Portal
 * Writes events to Firestore `activity` collection.
 */

const ActivityLog = (function () {
  "use strict";

  let _searchTimer = null;
  let _cachedIp = null;
  const SEARCH_DEBOUNCE_MS = 2000;

  // Fetch IP once per session and cache it
  function _fetchIp() {
    if (_cachedIp) return Promise.resolve(_cachedIp);
    return fetch("https://api.ipify.org?format=json")
      .then(function (r) { return r.json(); })
      .then(function (data) { _cachedIp = data.ip; return _cachedIp; })
      .catch(function () { return "unknown"; });
  }

  // Kick off IP fetch immediately on load
  _fetchIp();

  function _getUser() {
    const session = getSession();
    const user = fbAuth.currentUser;
    return {
      userId: user ? user.uid : "unknown",
      username: session ? session.username : "unknown",
    };
  }

  function log(action, details) {
    try {
      const user = _getUser();
      _fetchIp().then(function (ip) {
        fbDb.collection("activity").add({
          userId: user.userId,
          username: user.username,
          action: action,
          details: details || null,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          userAgent: navigator.userAgent,
          ip: ip,
        });
      });
    } catch (e) {
      console.error("ActivityLog error:", e);
    }
  }

  function logSearch(query) {
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function () {
      if (query && query.trim().length > 0) {
        log("search", { query: query.trim() });
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  return { log: log, logSearch: logSearch };
})();
