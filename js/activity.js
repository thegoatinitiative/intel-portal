/**
 * activity.js — Activity logging module for Intel Portal
 * Writes events to Firestore `activity` collection.
 */

const ActivityLog = (function () {
  "use strict";

  let _searchTimer = null;
  const SEARCH_DEBOUNCE_MS = 2000;

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
      fbDb.collection("activity").add({
        userId: user.userId,
        username: user.username,
        action: action,
        details: details || null,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent,
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
