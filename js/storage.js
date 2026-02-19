/**
 * storage.js — Firestore persistence for Intel Portal
 * Stores reports in Firestore so all authenticated users see the same data.
 * Attachments with dataUrls are stored inline (Firestore doc limit: 1MB).
 * Falls back to IndexedDB for large attachments.
 */

const StorageDB = (function () {
  "use strict";

  var COLLECTION = "reports";

  // Strip large dataUrls from attachments before saving to Firestore
  // to stay under the 1MB doc limit. Store them in IndexedDB instead.
  var DB_NAME = "intel_portal_blobs";
  var DB_VERSION = 1;
  var BLOB_STORE = "blobs";

  function openLocalDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function saveBlobLocal(key, dataUrl) {
    return openLocalDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BLOB_STORE, "readwrite");
        tx.objectStore(BLOB_STORE).put({ key: key, dataUrl: dataUrl });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getBlobLocal(key) {
    return openLocalDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BLOB_STORE, "readonly");
        var request = tx.objectStore(BLOB_STORE).get(key);
        request.onsuccess = function () {
          resolve(request.result ? request.result.dataUrl : null);
        };
        request.onerror = function () { resolve(null); };
      });
    });
  }

  // Max size for inline dataUrl in Firestore (leave room for other fields)
  var MAX_INLINE_SIZE = 800000; // ~800KB

  function prepareForFirestore(report) {
    var clone = Object.assign({}, report);
    var blobPromises = [];

    if (clone.attachments && clone.attachments.length > 0) {
      clone.attachments = clone.attachments.map(function (att, i) {
        var attClone = Object.assign({}, att);
        if (attClone.dataUrl && attClone.dataUrl.length > MAX_INLINE_SIZE) {
          // Store large blob locally, save a reference
          var blobKey = report.id + "_att_" + i;
          blobPromises.push(saveBlobLocal(blobKey, attClone.dataUrl));
          attClone.dataUrl = "local:" + blobKey;
        }
        return attClone;
      });
    }

    return Promise.all(blobPromises).then(function () {
      return clone;
    });
  }

  function restoreFromFirestore(report) {
    if (!report.attachments || report.attachments.length === 0) {
      return Promise.resolve(report);
    }

    var promises = report.attachments.map(function (att) {
      if (att.dataUrl && att.dataUrl.indexOf("local:") === 0) {
        var blobKey = att.dataUrl.replace("local:", "");
        return getBlobLocal(blobKey).then(function (dataUrl) {
          att.dataUrl = dataUrl;
        });
      }
      return Promise.resolve();
    });

    return Promise.all(promises).then(function () {
      return report;
    });
  }

  function saveReport(report) {
    return prepareForFirestore(report).then(function (cleaned) {
      return fbDb.collection(COLLECTION).doc(report.id).set(cleaned);
    });
  }

  function deleteReport(id) {
    return fbDb.collection(COLLECTION).doc(id).delete();
  }

  function getAllReports() {
    return fbDb.collection(COLLECTION).orderBy("date", "desc").get()
      .then(function (snap) {
        var reports = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          // Strip dataUrl from attachments to keep memory low.
          // Full data is fetched on demand via getReport().
          if (data.attachments) {
            data.attachments = data.attachments.map(function (att) {
              return { name: att.name, type: att.type, size: att.size };
            });
          }
          reports.push(data);
        });
        return reports;
      });
  }

  function getReport(id) {
    return fbDb.collection(COLLECTION).doc(id).get().then(function (doc) {
      if (!doc.exists) return null;
      return restoreFromFirestore(doc.data());
    });
  }

  function saveAllReports(reports) {
    var batch = fbDb.batch();
    var blobPromises = [];

    reports.forEach(function (report) {
      blobPromises.push(
        prepareForFirestore(report).then(function (cleaned) {
          var ref = fbDb.collection(COLLECTION).doc(report.id);
          batch.set(ref, cleaned);
        })
      );
    });

    return Promise.all(blobPromises).then(function () {
      return batch.commit();
    });
  }

  return {
    saveReport: saveReport,
    deleteReport: deleteReport,
    getAllReports: getAllReports,
    getReport: getReport,
    saveAllReports: saveAllReports,
  };
})();
