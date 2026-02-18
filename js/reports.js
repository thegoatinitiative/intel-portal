/**
 * reports.js — Report data store
 *
 * Reports are loaded from IndexedDB on startup. New reports are created
 * via the dashboard upload form. This array starts empty and is populated
 * by dashboard.js from persistent storage.
 */

const REPORTS = [];
