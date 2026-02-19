/**
 * storage.js — Firestore + Firebase Storage persistence for Intel Portal
 * Reports metadata stored in Firestore; attachment files in Firebase Storage.
 */

const StorageDB = (function () {
  "use strict";

  var COLLECTION = "reports";

  /**
   * Upload a File or Blob to Firebase Storage.
   * Returns { storageUrl, storagePath }.
   */
  function uploadAttachment(reportId, fileName, fileData) {
    var path = "attachments/" + reportId + "/" + fileName;
    var ref = fbStorage.ref(path);
    return ref.put(fileData).then(function () {
      return ref.getDownloadURL().then(function (url) {
        return { storageUrl: url, storagePath: path };
      });
    });
  }

  /**
   * Delete a file from Firebase Storage by its path.
   */
  function deleteAttachment(storagePath) {
    if (!storagePath) return Promise.resolve();
    return fbStorage.ref(storagePath).delete().catch(function (err) {
      // Ignore "not found" errors (file may already be deleted)
      if (err.code === "storage/object-not-found") return;
      throw err;
    });
  }

  /**
   * Before saving to Firestore, upload any attachment that has a raw `file`
   * (File object) to Firebase Storage. Replace the `file` with `storageUrl`
   * and `storagePath`. Also handles legacy `dataUrl` by uploading it.
   */
  function prepareForFirestore(report) {
    var clone = Object.assign({}, report);
    if (!clone.attachments || clone.attachments.length === 0) {
      return Promise.resolve(clone);
    }

    var uploadPromises = clone.attachments.map(function (att, i) {
      var attClone = Object.assign({}, att);
      clone.attachments[i] = attClone;

      if (attClone.file) {
        // New attachment with a File object — upload to Storage
        return uploadAttachment(report.id, attClone.name, attClone.file)
          .then(function (result) {
            attClone.storageUrl = result.storageUrl;
            attClone.storagePath = result.storagePath;
            delete attClone.file;
            delete attClone.dataUrl;
          });
      } else if (attClone.dataUrl && !attClone.storageUrl) {
        // Legacy inline base64 — convert to Storage
        var byteString = atob(attClone.dataUrl.split(",")[1]);
        var mimeType = attClone.type || "application/octet-stream";
        var ab = new ArrayBuffer(byteString.length);
        var ia = new Uint8Array(ab);
        for (var j = 0; j < byteString.length; j++) {
          ia[j] = byteString.charCodeAt(j);
        }
        var blob = new Blob([ab], { type: mimeType });
        return uploadAttachment(report.id, attClone.name, blob)
          .then(function (result) {
            attClone.storageUrl = result.storageUrl;
            attClone.storagePath = result.storagePath;
            delete attClone.dataUrl;
          });
      }
      // Already has storageUrl or no data — leave as-is
      delete attClone.file;
      delete attClone.dataUrl;
      return Promise.resolve();
    });

    return Promise.all(uploadPromises).then(function () {
      return clone;
    });
  }

  function saveReport(report) {
    return prepareForFirestore(report).then(function (cleaned) {
      return fbDb.collection(COLLECTION).doc(report.id).set(cleaned).then(function () {
        return cleaned;
      });
    });
  }

  function deleteReport(id) {
    // Delete all Storage files under attachments/{id}/ then the Firestore doc
    return fbDb.collection(COLLECTION).doc(id).get().then(function (doc) {
      var promises = [];
      if (doc.exists) {
        var data = doc.data();
        if (data.attachments) {
          data.attachments.forEach(function (att) {
            if (att.storagePath) {
              promises.push(deleteAttachment(att.storagePath));
            }
          });
        }
      }
      promises.push(fbDb.collection(COLLECTION).doc(id).delete());
      return Promise.all(promises);
    });
  }

  function getAllReports() {
    return fbDb.collection(COLLECTION).orderBy("date", "desc").get()
      .then(function (snap) {
        var reports = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          // Strip heavy fields; keep metadata + storage references
          if (data.attachments) {
            data.attachments = data.attachments.map(function (att) {
              return {
                name: att.name,
                type: att.type,
                size: att.size,
                storageUrl: att.storageUrl || null,
                storagePath: att.storagePath || null,
              };
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
      return doc.data();
    });
  }

  function saveAllReports(reports) {
    var batch = fbDb.batch();
    var prepPromises = [];

    reports.forEach(function (report) {
      prepPromises.push(
        prepareForFirestore(report).then(function (cleaned) {
          var ref = fbDb.collection(COLLECTION).doc(report.id);
          batch.set(ref, cleaned);
        })
      );
    });

    return Promise.all(prepPromises).then(function () {
      return batch.commit();
    });
  }

  return {
    saveReport: saveReport,
    deleteReport: deleteReport,
    deleteAttachment: deleteAttachment,
    getAllReports: getAllReports,
    getReport: getReport,
    saveAllReports: saveAllReports,
  };
})();
