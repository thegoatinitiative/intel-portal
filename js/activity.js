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

  // ---- Time-on-page tracking ----
  var _pageStart = Date.now();
  var _currentPage = null;

  function startPageTimer(pageName) {
    _pageStart = Date.now();
    _currentPage = pageName;
  }

  function _logTimeOnPage() {
    if (!_currentPage) return;
    var seconds = Math.round((Date.now() - _pageStart) / 1000);
    if (seconds < 2) return; // ignore very short visits
    // Use sendBeacon for reliability on page unload
    try {
      var user = _getUser();
      var payload = {
        userId: user.userId,
        username: user.username,
        action: "time_on_page",
        details: { page: _currentPage, seconds: seconds },
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        ip: _cachedIp || "unknown",
      };
      // Try sendBeacon first (works on tab close), fall back to Firestore write
      if (navigator.sendBeacon) {
        // Can't use sendBeacon with Firestore directly, so write synchronously
      }
      fbDb.collection("activity").add({
        userId: user.userId,
        username: user.username,
        action: "time_on_page",
        details: { page: _currentPage, seconds: seconds },
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent,
        ip: _cachedIp || "unknown",
      });
    } catch (e) {
      // silently fail on unload
    }
  }

  // Log time when user leaves/closes page
  window.addEventListener("beforeunload", _logTimeOnPage);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      _logTimeOnPage();
      // Reset so we don't double-log
      _pageStart = Date.now();
    } else if (document.visibilityState === "visible") {
      _pageStart = Date.now();
    }
  });

  return { log: log, logSearch: logSearch, startPageTimer: startPageTimer };
})();
