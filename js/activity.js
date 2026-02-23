/**
 * activity.js — Activity logging module for Intel Portal
 * Writes events to Firestore `activity` collection.
 */

const ActivityLog = (function () {
  "use strict";

  let _searchTimer = null;
  let _cachedIp = null;
  const SEARCH_DEBOUNCE_MS = 2000;

  // Fetch IP once per session and cache it, with fallback services
  var _ipServices = [
    { url: "https://api.ipify.org?format=json", extract: function (d) { return d.ip; } },
    { url: "https://api.seeip.org/jsonip", extract: function (d) { return d.ip; } },
    { url: "https://ipapi.co/json/", extract: function (d) { return d.ip; } },
  ];

  function _fetchIp() {
    if (_cachedIp) return Promise.resolve(_cachedIp);

    function _tryService(i) {
      if (i >= _ipServices.length) return Promise.resolve("unknown");
      var svc = _ipServices[i];
      return fetch(svc.url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var ip = svc.extract(data);
          if (ip) { _cachedIp = ip; return ip; }
          return _tryService(i + 1);
        })
        .catch(function () { return _tryService(i + 1); });
    }

    return _tryService(0);
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
