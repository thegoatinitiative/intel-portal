/**
 * dashboard.js — Executive Briefing Dashboard
 * Auto-expands all documents for immediate review.
 * Uses DOMPurify for XSS protection. Persists via Firestore + Firebase Storage.
 */

(async function () {
  "use strict";

  await requireAuth();
  ActivityLog.log("page_view", { page: "dashboard" });
  ActivityLog.startPageTimer("dashboard");

  // Show Admin tab and New Report button only for admins
  let currentUserIsAdmin = false;
  const adminReady = isAdmin().then(function (admin) {
    currentUserIsAdmin = admin;
    if (admin) {
      var adminTab = document.getElementById("admin-tab");
      if (adminTab) adminTab.hidden = false;
    } else {
      var uploadBtn = document.getElementById("upload-btn");
      if (uploadBtn) uploadBtn.style.display = "none";
    }
  });

  const session = getSession();
  const userDisplay = document.getElementById("user-display");
  if (session && userDisplay) {
    userDisplay.textContent = session.username.toUpperCase();
  }

  const reportListEl = document.getElementById("report-list");
  const searchInput = document.getElementById("search-input");
  const countryFilter = document.getElementById("country-filter");
  const reportPlaceholder = document.getElementById("report-placeholder");
  const reportContentEl = document.getElementById("report-content");
  const reportActionsEl = document.getElementById("report-actions");
  const reportMetaEl = document.getElementById("report-meta");
  const reportBodyEl = document.getElementById("report-body");

  let activeMap = null; // Track Leaflet map instance for cleanup

  const uploadBtn = document.getElementById("upload-btn");
  const uploadModal = document.getElementById("upload-modal");
  const modalClose = document.getElementById("modal-close");
  const modalCancel = document.getElementById("modal-cancel");
  const uploadForm = document.getElementById("upload-form");
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");

  let activeReportId = null;
  let pendingFiles = [];
  let editingReportId = null; // null = creating new, string = editing existing

  // ---- Load reports from Firestore (with timeout to prevent hang) ----
  try {
    const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 3000));
    const saved = await Promise.race([StorageDB.getAllReports(), dbTimeout]);
    if (saved && saved.length > 0) {
      REPORTS.length = 0;
      REPORTS.push(...saved);
      console.log("Loaded " + saved.length + " report(s) from storage.");
    }
  } catch (e) {
    console.error("Failed to load from Firestore:", e);
  }

  // ---- Seed RPT-2026-0012 if not already present ----
  if (!REPORTS.find(function (r) { return r.id === "RPT-2026-0012"; })) {
    var seedReport = {
      id: "RPT-2026-0012",
      passportNumber: "D10005432",
      subjectName: "Issa REZAEI",
      nationality: "Iranian",
      date: "2026-02-25",
      classification: "secret",
      summary: "Dual-Identity Iranian Defense Official Operating Under Venezuelan Cover (Subject IRIDIUM-7)",
      content: "",
      attachments: []
    };
    REPORTS.push(seedReport);
    StorageDB.saveReport(seedReport).catch(function (e) { console.error("Failed to seed RPT-2026-0012:", e); });
  }

  // ---- Seed/fix RPT-2026-0013 ----
  (function () {
    var existing = REPORTS.find(function (r) { return r.id === "RPT-2026-0013"; });
    if (existing) {
      // Fix bad longitude if present
      if (existing.lng && (existing.lng < -180 || existing.lng > 180)) {
        existing.lat = 32.607553;
        existing.lng = -116.243793;
        existing.locationName = "Campo, CA";
        StorageDB.saveReport(existing).catch(function (e) { console.error("Failed to fix RPT-2026-0013:", e); });
      }
    } else {
      var seedReport2 = {
        id: "RPT-2026-0013",
        passportNumber: "E84248574",
        subjectName: "ZHANG Ping",
        nationality: "Chinese",
        date: "2026-02-25",
        classification: "confidential",
        summary: "PRC National with Multi-Country Transit Anomaly — Tier 2 Legitimate-Travel Anomaly (Subject ZHANG, Ping)",
        lat: 32.607553,
        lng: -116.243793,
        locationName: "Campo, CA",
        content: "",
        attachments: []
      };
      REPORTS.push(seedReport2);
      StorageDB.saveReport(seedReport2).catch(function (e) { console.error("Failed to seed RPT-2026-0013:", e); });
    }
  })();

  // ---- Seed RPT-2026-0014 (ASSEIR, Mohamud Mohamed) ----
  if (!REPORTS.find(function (r) { return r.id === "RPT-2026-0014"; })) {
    var seedReport3 = {
      id: "RPT-2026-0014",
      passportNumber: "SEGOB-INM-00100135",
      subjectName: "ASSEIR, Mohamud Mohamed",
      nationality: "Somali",
      date: "2026-02-27",
      classification: "top-secret",
      summary: "Somali SIA National — Mexican Humanitarian Visa (TVRH) Recovered at U.S. Border Zone, Expired 2+ Years (Subject HORN-9)",
      content: "",
      attachments: []
    };
    REPORTS.push(seedReport3);
    // Save report first, then upload the PDF attachment from local file
    StorageDB.saveReport(seedReport3).then(function () {
      return fetch("attachments/RPT-2026-0014_Asseir_Mohamud_Mohamed.pdf");
    }).then(function (resp) {
      if (!resp.ok) throw new Error("PDF not found locally");
      return resp.blob();
    }).then(function (blob) {
      var pdfFile = new File([blob], "Asseir_Mohamud_Mohamed.pdf", { type: "application/pdf" });
      seedReport3.attachments = [{
        name: "Asseir_Mohamud_Mohamed.pdf",
        type: "application/pdf",
        size: pdfFile.size,
        file: pdfFile
      }];
      return StorageDB.saveReport(seedReport3);
    }).then(function () {
      console.log("Seeded RPT-2026-0014 with PDF attachment.");
    }).catch(function (e) {
      console.error("Failed to seed RPT-2026-0014 attachment:", e);
    });
  }

  // ---- Seed RPT-2026-0015 (BAKHRITDINOVA, Zilola) ----
  if (!REPORTS.find(function (r) { return r.id === "RPT-2026-0015"; })) {
    var seedReport4 = {
      id: "RPT-2026-0015",
      passportNumber: "0000002804753",
      subjectName: "BAKHRITDINOVA, Zilola",
      nationality: "Uzbek",
      date: "2026-02-27",
      classification: "secret",
      summary: "Uzbek National — Expired Mexican Humanitarian Visa (TVRH) Recovered at U.S. Border Zone, SIC Vetting Required (Subject SILK-4)",
      content: "",
      attachments: []
    };
    REPORTS.push(seedReport4);
    StorageDB.saveReport(seedReport4).then(function () {
      return fetch("attachments/RPT-2026-0015_Bakhritdinova_Zilola.pdf");
    }).then(function (resp) {
      if (!resp.ok) throw new Error("PDF not found locally");
      return resp.blob();
    }).then(function (blob) {
      var pdfFile = new File([blob], "Bakhritdinova_Zilola.pdf", { type: "application/pdf" });
      seedReport4.attachments = [{
        name: "Bakhritdinova_Zilola.pdf",
        type: "application/pdf",
        size: pdfFile.size,
        file: pdfFile
      }];
      return StorageDB.saveReport(seedReport4);
    }).then(function () {
      console.log("Seeded RPT-2026-0015 with PDF attachment.");
    }).catch(function (e) {
      console.error("Failed to seed RPT-2026-0015 attachment:", e);
    });
  }

  // ---- Check which reports have intel assessments ----
  var reportsWithAssessment = {};
  await Promise.all(REPORTS.map(function (r) {
    return fetch("reports/" + r.id + ".html", { method: "HEAD" }).then(function (resp) {
      if (resp.ok) reportsWithAssessment[r.id] = true;
    }).catch(function () {});
  }));

  // ---- Populate country filter dropdown ----
  (function populateCountryFilter() {
    var nationalities = [];
    REPORTS.forEach(function (r) {
      if (r.nationality && nationalities.indexOf(r.nationality) === -1) {
        nationalities.push(r.nationality);
      }
    });
    nationalities.sort();
    nationalities.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      countryFilter.appendChild(opt);
    });
  })();

  // ---- Helpers ----

  function setSafeHTML(el, html) {
    if (typeof DOMPurify !== "undefined") {
      el.innerHTML = DOMPurify.sanitize(html);
    } else {
      el.textContent = html;
    }
  }

  function getFileIcon(type) {
    if (type === "application/pdf") return "\uD83D\uDCC4";
    if (type.startsWith("image/")) return "\uD83D\uDDBC";
    if (type.startsWith("text/")) return "\uD83D\uDCDD";
    return "\uD83D\uDCCE";
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // ---- PDF Renderer (uses PDF.js to render each page as a canvas) ----

  async function renderPDFPages(source, container) {
    // source can be a storageUrl (https://...) or a legacy data URL
    const loading = document.createElement("div");
    loading.style.cssText = "padding:2rem;text-align:center;color:var(--text-muted);font-size:0.9rem;";
    loading.textContent = "Rendering PDF pages...";
    container.appendChild(loading);

    try {
      // Wait for PDF.js to load
      if (window.pdfjsReady) await window.pdfjsReady;
      if (!window.pdfjsLib) throw new Error("PDF.js not available");

      var pdfData;
      if (source.startsWith("data:")) {
        // Legacy data URL — decode base64
        var base64 = source.split(",")[1];
        if (!base64) throw new Error("Invalid data URL");
        var raw = atob(base64);
        pdfData = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) pdfData[i] = raw.charCodeAt(i);
      } else {
        // Storage URL — fetch as ArrayBuffer
        var resp = await fetch(source);
        if (!resp.ok) throw new Error("Failed to fetch PDF (" + resp.status + ")");
        pdfData = new Uint8Array(await resp.arrayBuffer());
      }

      const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
      container.removeChild(loading);

      const totalPages = pdf.numPages;
      const maxPages = Math.min(totalPages, 20);
      for (let num = 1; num <= maxPages; num++) {
        const page = await pdf.getPage(num);
        const scale = 1.2;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = "width:100%;height:auto;display:block;";

        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        container.appendChild(canvas);

        // Page separator
        if (num < maxPages) {
          const sep = document.createElement("div");
          sep.style.cssText = "height:2px;background:var(--border);";
          container.appendChild(sep);
        }
      }

      if (totalPages > maxPages) {
        const note = document.createElement("div");
        note.style.cssText = "padding:1rem;text-align:center;color:var(--text-muted);font-size:0.8rem;";
        note.textContent = "Showing " + maxPages + " of " + totalPages + " pages.";
        container.appendChild(note);
      }
    } catch (e) {
      loading.textContent = "Unable to render PDF: " + e.message;
    }
  }

  // ---- Sidebar ----

  function buildReportListItem(report) {
    const li = document.createElement("li");
    li.className = "report-item" + (report.id === activeReportId ? " active" : "");

    const classMap = {
      "top-secret": "classification-top-secret",
      secret: "classification-secret",
      confidential: "classification-confidential",
    };

    const passport = document.createElement("div");
    passport.className = "report-item-passport";
    passport.textContent = report.passportNumber;

    const name = document.createElement("div");
    name.className = "report-item-name";
    name.textContent = report.subjectName;

    const date = document.createElement("div");
    date.className = "report-item-date";
    date.textContent = report.date + " \u2014 " + report.nationality;

    const cls = document.createElement("span");
    cls.className = "report-item-classification " + (classMap[report.classification] || "");
    cls.textContent = report.classification.replace("-", " ");

    li.appendChild(passport);
    li.appendChild(name);
    li.appendChild(date);
    li.appendChild(cls);

    if (report.attachments && report.attachments.length > 0) {
      const badge = document.createElement("div");
      badge.className = "report-item-date";
      badge.textContent = report.attachments.length + " document(s) attached";
      li.appendChild(badge);
    }

    li.addEventListener("click", () => openReport(report.id));
    return li;
  }

  function renderReportList(filter, country) {
    const query = (filter || "").toLowerCase();
    const countryVal = (country || "").toLowerCase();
    reportListEl.replaceChildren();

    const filtered = REPORTS.filter((r) => {
      if (!currentUserIsAdmin && r.classification === "top-secret") return false;
      if (countryVal && r.nationality.toLowerCase() !== countryVal) return false;
      if (!query) return true;
      return (
        r.passportNumber.toLowerCase().includes(query) ||
        r.subjectName.toLowerCase().includes(query) ||
        r.id.toLowerCase().includes(query) ||
        r.summary.toLowerCase().includes(query) ||
        r.nationality.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.style.cssText = "padding:2rem;color:var(--text-muted);text-align:center;font-size:0.85rem;";
      empty.textContent = "No reports match your search.";
      reportListEl.appendChild(empty);
      return;
    }

    // Pin reports with intel assessments to top, sorted by ID
    var withAssessment = [];
    var without = [];
    filtered.forEach(function (r) {
      if (reportsWithAssessment[r.id]) { withAssessment.push(r); }
      else { without.push(r); }
    });
    withAssessment.sort(function (a, b) { return a.id.localeCompare(b.id); });
    withAssessment.concat(without).forEach((r) => reportListEl.appendChild(buildReportListItem(r)));
  }

  // ---- Report Viewer (executive layout, auto-expanded docs) ----

  async function openReport(id) {
    const reportMeta = REPORTS.find((r) => r.id === id);
    if (!reportMeta) return;
    if (!currentUserIsAdmin && reportMeta.classification === "top-secret") return;

    activeReportId = id;
    ActivityLog.log("report_view", { reportId: id, subject: reportMeta.subjectName });
    renderReportList(searchInput.value, countryFilter.value);

    reportPlaceholder.hidden = true;
    reportContentEl.hidden = false;

    // Mobile: switch to report view
    document.querySelector(".dashboard-layout").classList.add("mobile-report-open");

    // Fetch full report data (with attachment blobs) on demand
    var report;
    try {
      report = await StorageDB.getReport(id);
      if (!report) report = reportMeta;
    } catch (e) {
      console.error("Failed to fetch full report:", e);
      report = reportMeta;
    }

    const viewer = document.querySelector(".report-viewer");
    viewer.scrollTop = 0;

    const classMap = {
      "top-secret": "classification-top-secret",
      secret: "classification-secret",
      confidential: "classification-confidential",
    };

    // Destroy previous Leaflet map to prevent "already initialized" crash
    if (activeMap) {
      try { activeMap.remove(); } catch (e) { /* ignore */ }
      activeMap = null;
    }

    // Clear previous content
    reportActionsEl.replaceChildren();
    reportMetaEl.replaceChildren();
    reportBodyEl.replaceChildren();

    // ---- Mobile back button ----
    const backBtn = document.createElement("button");
    backBtn.className = "mobile-back-btn";
    backBtn.textContent = "\u2190 All Reports";
    backBtn.addEventListener("click", function () {
      document.querySelector(".dashboard-layout").classList.remove("mobile-report-open");
      activeReportId = null;
      reportContentEl.hidden = true;
      reportPlaceholder.hidden = false;
      renderReportList(searchInput.value, countryFilter.value);
    });
    reportMetaEl.appendChild(backBtn);

    // ---- Header Banner ----
    const banner = document.createElement("div");
    banner.className = "report-header-banner";

    // Top row: title + delete
    const topRow = document.createElement("div");
    topRow.className = "report-header-top";

    const titleBlock = document.createElement("div");
    titleBlock.className = "report-title-block";

    const h1 = document.createElement("h1");
    h1.textContent = report.subjectName;

    const idLine = document.createElement("div");
    idLine.className = "report-title-id";
    idLine.textContent = report.id + " \u2022 " + report.passportNumber;

    titleBlock.appendChild(h1);
    titleBlock.appendChild(idLine);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "report-header-actions";

    const isUserAdmin = await isAdmin();

    if (isUserAdmin) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-action";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => editReport(report));
      actionsDiv.appendChild(editBtn);
    }

    const isMobile = window.innerWidth <= 768;

    if (!isMobile) {
      const printBtn = document.createElement("button");
      printBtn.type = "button";
      printBtn.className = "btn-action";
      printBtn.textContent = "Print";
      printBtn.addEventListener("click", () => { ActivityLog.log("report_export", { reportId: report.id, method: "print" }); window.print(); });
      actionsDiv.appendChild(printBtn);
    }

    if (isUserAdmin) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => confirmDelete(report));
      actionsDiv.appendChild(deleteBtn);
    }

    topRow.appendChild(titleBlock);
    topRow.appendChild(actionsDiv);
    banner.appendChild(topRow);

    // Meta grid
    const grid = document.createElement("div");
    grid.className = "report-meta-grid";

    const fields = [
      ["Passport No.", report.passportNumber, true],
      ["Nationality", report.nationality, false],
      ["Report Date", report.date, false],
      ["Classification", report.classification.replace("-", " ").toUpperCase(), false],
      ["Summary", report.summary, false],
    ];

    fields.forEach(([label, value, isMono]) => {
      const item = document.createElement("div");
      item.className = "meta-item";
      if (label === "Summary") item.style.gridColumn = "1 / -1";

      const lbl = document.createElement("span");
      lbl.className = "meta-label";
      lbl.textContent = label;

      if (label === "Classification" && isUserAdmin) {
        const select = document.createElement("select");
        select.className = "classification-select";
        var classOptions = [
          { value: "top-secret", label: "TOP SECRET" },
          { value: "secret", label: "SECRET" },
          { value: "confidential", label: "CONFIDENTIAL" }
        ];
        classOptions.forEach(function (opt) {
          var option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          if (opt.value === report.classification) option.selected = true;
          select.appendChild(option);
        });
        select.className = "classification-select " + (classMap[report.classification] || "");
        select.addEventListener("change", function () {
          var newClass = select.value;
          report.classification = newClass;
          select.className = "classification-select " + (classMap[newClass] || "");
          StorageDB.saveReport(report).then(function () {
            renderReportList(searchInput.value, countryFilter.value);
            ActivityLog.log("classification_changed", { reportId: report.id, classification: newClass });
          }).catch(function (e) { console.error("Failed to update classification:", e); });
        });
        item.appendChild(lbl);
        item.appendChild(select);
      } else if (label === "Classification") {
        const badge = document.createElement("span");
        badge.className = "report-item-classification " + (classMap[report.classification] || "");
        badge.textContent = value;
        item.appendChild(lbl);
        item.appendChild(badge);
      } else {
        const val = document.createElement("span");
        val.className = isMono ? "meta-value mono" : "meta-value";
        val.textContent = value;
        item.appendChild(lbl);
        item.appendChild(val);
      }

      grid.appendChild(item);
    });

    banner.appendChild(grid);
    reportMetaEl.appendChild(banner);

    // ---- Auto-expanded documents ----
    if (report.attachments && report.attachments.length > 0) {
      const docsSection = document.createElement("div");
      docsSection.className = "documents-section";

      const header = document.createElement("div");
      header.className = "documents-section-header";
      header.textContent = "Attached Documents (" + report.attachments.length + ")";
      docsSection.appendChild(header);

      report.attachments.forEach((att) => {
        const embed = document.createElement("div");
        embed.className = "document-embed";

        // Header bar
        const embedHeader = document.createElement("div");
        embedHeader.className = "document-embed-header";

        const icon = document.createElement("span");
        icon.className = "document-embed-icon";
        icon.textContent = getFileIcon(att.type);

        const nameEl = document.createElement("span");
        nameEl.className = "document-embed-name";
        nameEl.textContent = att.name;

        const sizeEl = document.createElement("span");
        sizeEl.className = "document-embed-size";
        sizeEl.textContent = formatFileSize(att.size);

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-delete";
        removeBtn.textContent = "Remove";
        removeBtn.style.cssText = "margin-left:auto;padding:0.25rem 0.7rem;font-size:0.65rem;flex-shrink:0;";
        removeBtn.addEventListener("click", function () {
          const idx = report.attachments.indexOf(att);
          if (idx > -1) {
            // Delete file from Firebase Storage
            var deletePromise = att.storagePath
              ? StorageDB.deleteAttachment(att.storagePath)
              : Promise.resolve();
            report.attachments.splice(idx, 1);
            deletePromise.then(function () {
              return StorageDB.saveReport(report);
            }).then(function () {
              openReport(report.id);
            });
          }
        });

        const downloadBtn = document.createElement("button");
        downloadBtn.className = "btn-action";
        downloadBtn.textContent = "Download";
        downloadBtn.style.cssText = "margin-left:auto;padding:0.25rem 0.7rem;font-size:0.65rem;flex-shrink:0;";
        downloadBtn.addEventListener("click", function () {
          var dlSrc = att.storageUrl || att.dataUrl;
          if (!dlSrc) return;
          var a = document.createElement("a");
          a.href = dlSrc;
          a.download = att.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });

        embedHeader.appendChild(icon);
        embedHeader.appendChild(nameEl);
        embedHeader.appendChild(sizeEl);
        embedHeader.appendChild(downloadBtn);
        if (isUserAdmin) {
          embedHeader.appendChild(removeBtn);
        }
        embed.appendChild(embedHeader);

        // Body — auto-expanded
        const body = document.createElement("div");
        body.className = "document-embed-body";

        var src = att.storageUrl || att.dataUrl;
        if (!src) {
          const msg = document.createElement("div");
          msg.style.cssText = "padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;";
          msg.textContent = "Attachment data not available.";
          body.appendChild(msg);
        } else if (att.type === "application/pdf") {
          renderPDFPages(src, body);
        } else if (att.type && att.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = att.name;
          body.appendChild(img);
        } else if (
          (att.type && att.type.startsWith("text/")) ||
          att.name.endsWith(".md") ||
          att.name.endsWith(".csv")
        ) {
          if (att.textContent) {
            const pre = document.createElement("pre");
            pre.textContent = att.textContent;
            body.appendChild(pre);
          } else {
            // Fetch text content from Storage URL
            fetch(src).then(function (r) { return r.text(); }).then(function (text) {
              const pre = document.createElement("pre");
              pre.textContent = text;
              body.appendChild(pre);
            }).catch(function () {
              const pre = document.createElement("pre");
              pre.textContent = "(Unable to read file)";
              body.appendChild(pre);
            });
          }
        } else {
          const dl = document.createElement("div");
          dl.style.cssText = "padding:1.5rem;text-align:center;";
          const link = document.createElement("a");
          link.href = src;
          link.download = att.name;
          link.textContent = "Download " + att.name;
          link.style.cssText = "color:var(--accent);font-weight:600;text-decoration:none;";
          dl.appendChild(link);
          body.appendChild(dl);
        }

        embed.appendChild(body);
        docsSection.appendChild(embed);
      });

      reportBodyEl.appendChild(docsSection);
    }

    // ---- Recovery Location Map ----
    if (report.lat != null && report.lng != null) {
      const mapSection = document.createElement("div");
      mapSection.className = "map-section";

      const mapHeader = document.createElement("div");
      mapHeader.className = "documents-section-header";
      mapHeader.textContent = "Recovery Location" + (report.locationName ? " \u2014 " + report.locationName : "");
      mapSection.appendChild(mapHeader);

      const coordsInfo = document.createElement("div");
      coordsInfo.className = "map-coords";
      coordsInfo.textContent = report.lat.toFixed(6) + ", " + report.lng.toFixed(6);
      mapSection.appendChild(coordsInfo);

      const mapContainer = document.createElement("div");
      mapContainer.className = "map-container";
      mapContainer.id = "report-map-" + report.id;
      mapSection.appendChild(mapContainer);

      reportBodyEl.appendChild(mapSection);

      // Initialize Leaflet map after DOM insertion
      setTimeout(function () {
        if (typeof L === "undefined") return;
        try {
        activeMap = L.map(mapContainer).setView([report.lat, report.lng], 13);
        const map = activeMap;
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          attribution: "&copy; Esri, Maxar, Earthstar Geographics",
          maxZoom: 19,
        }).addTo(map);
        L.marker([report.lat, report.lng])
          .addTo(map)
          .bindPopup(
            "<strong>" + (report.locationName || "Recovery Site") + "</strong><br>" +
            report.lat.toFixed(6) + ", " + report.lng.toFixed(6) +
            (report.subjectName ? "<br>Subject: " + report.subjectName : "")
          )
          .openPopup();
        } catch (e) { console.error("Map init error:", e); }
      }, 100);
    }

    // ---- Report body (Markdown) ----
    if (report.content) {
      const section = document.createElement("div");
      section.className = "report-body-section";
      if (typeof marked !== "undefined") {
        setSafeHTML(section, marked.parse(report.content));
      } else {
        section.textContent = report.content;
      }
      reportBodyEl.appendChild(section);
    }

    // ---- Inline Intel Assessment (iframe for full JS/CSS support) ----
    var assessmentUrl = "reports/" + report.id + ".html";
    fetch(assessmentUrl, { method: "HEAD" }).then(function (resp) {
      if (!resp.ok) return;
      var iframe = document.createElement("iframe");
      iframe.src = assessmentUrl;
      iframe.className = "intel-assessment-iframe";
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "true");
      // Auto-resize iframe to fit content, apply overrides, enable editing
      iframe.addEventListener("load", function () {
        try {
          var h = iframe.contentDocument.documentElement.scrollHeight;
          iframe.style.height = h + "px";
        } catch (e) { /* cross-origin fallback stays at CSS default */ }

        // Apply saved field overrides and enable editing for admins
        applyFieldOverrides(iframe, report);
        if (isUserAdmin) enableFieldEditing(iframe, report);

        // Re-measure after overrides may have changed content height
        try {
          var h2 = iframe.contentDocument.documentElement.scrollHeight;
          iframe.style.height = h2 + "px";
        } catch (e) { /* ignore */ }
      });
      reportBodyEl.appendChild(iframe);
    }).catch(function () { /* no assessment available */ });
  }

  // ---- Export Report as PDF ----

  function exportReportPDF(report) {
    if (!window.html2pdf) {
      alert("PDF export is loading, please try again in a moment.");
      return;
    }

    var el = document.getElementById("report-meta");
    var bodyEl = document.getElementById("report-body");

    // Create a temporary container with both sections
    var container = document.createElement("div");
    container.style.cssText = "background:#fff;color:#1a1a2e;padding:20px;font-family:Inter,sans-serif;";
    container.innerHTML = el.innerHTML + bodyEl.innerHTML;

    // Remove buttons, interactive elements, and iframes
    container.querySelectorAll("button, .btn-action, .btn-delete, .mobile-back-btn, .remove-btn, iframe").forEach(function (b) { b.remove(); });

    var filename = (report.id || "report") + ".pdf";

    html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] }
    }).from(container).save();
  }


  // ---- Edit Report ----

  function editReport(report) {
    editingReportId = report.id;

    // Pre-fill the form
    document.getElementById("rpt-passport").value = report.passportNumber || "";
    document.getElementById("rpt-name").value = report.subjectName || "";
    document.getElementById("rpt-nationality").value = report.nationality || "";
    document.getElementById("rpt-date").value = report.date || "";
    document.getElementById("rpt-classification").value = report.classification || "secret";
    document.getElementById("rpt-summary").value = report.summary || "";
    document.getElementById("rpt-content").value = report.content || "";
    document.getElementById("rpt-location").value = report.locationName || "";
    document.getElementById("rpt-lat").value = report.lat != null ? report.lat : "";
    document.getElementById("rpt-lng").value = report.lng != null ? report.lng : "";

    // Pre-populate the file list display with existing attachments
    pendingFiles = [];
    fileListEl.replaceChildren();
    if (report.attachments && report.attachments.length > 0) {
      report.attachments.forEach(function (att) {
        const li = document.createElement("li");
        li.className = "file-list-item";

        const n = document.createElement("span");
        n.className = "file-name";
        n.textContent = att.name + " (existing)";

        const s = document.createElement("span");
        s.className = "file-size";
        s.textContent = formatFileSize(att.size);

        li.appendChild(n);
        li.appendChild(s);
        fileListEl.appendChild(li);
      });
    }

    // Update modal title
    uploadModal.querySelector(".modal-header h2").textContent = "Edit Report \u2014 " + report.id;

    // Show modal
    uploadModal.hidden = false;
  }

  // ---- Delete ----

  function confirmDelete(report) {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    const box = document.createElement("div");
    box.className = "confirm-box";

    const h3 = document.createElement("h3");
    h3.textContent = "Delete Report";

    const p = document.createElement("p");
    p.textContent = 'Permanently delete ' + report.id + ' (' + report.subjectName + ')? This cannot be undone.';

    const actions = document.createElement("div");
    actions.className = "confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn-confirm-delete";
    confirmBtn.textContent = "Delete";
    confirmBtn.addEventListener("click", async () => {
      ActivityLog.log("report_delete", { reportId: report.id, subject: report.subjectName });
      const idx = REPORTS.findIndex((r) => r.id === report.id);
      if (idx !== -1) REPORTS.splice(idx, 1);
      try { await StorageDB.deleteReport(report.id); } catch (e) {}
      overlay.remove();
      activeReportId = null;
      reportContentEl.hidden = true;
      reportPlaceholder.hidden = false;
      renderReportList(searchInput.value, countryFilter.value);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(h3);
    box.appendChild(p);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ---- Upload Modal ----

  function openModal() {
    editingReportId = null;
    uploadModal.hidden = false;
    pendingFiles = [];
    fileListEl.replaceChildren();
    uploadForm.reset();
    document.getElementById("rpt-date").valueAsDate = new Date();
    uploadModal.querySelector(".modal-header h2").textContent = "Create New Report";
  }

  function closeModal() {
    editingReportId = null;
    uploadModal.hidden = true;
    pendingFiles = [];
    fileListEl.replaceChildren();
    uploadForm.reset();
    uploadModal.querySelector(".modal-header h2").textContent = "Create New Report";
  }

  uploadBtn.addEventListener("click", openModal);
  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  uploadModal.addEventListener("click", (e) => { if (e.target === uploadModal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !uploadModal.hidden) closeModal(); });

  // ---- Geolocation button ----
  const useLocationBtn = document.getElementById("btn-use-coords");
  if (useLocationBtn) {
    useLocationBtn.addEventListener("click", function () {
      if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
      }
      useLocationBtn.textContent = "Locating...";
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          document.getElementById("rpt-lat").value = pos.coords.latitude.toFixed(6);
          document.getElementById("rpt-lng").value = pos.coords.longitude.toFixed(6);
          useLocationBtn.textContent = "Updated";
          setTimeout(function () { useLocationBtn.textContent = "Use My Location"; }, 2000);
        },
        function () {
          alert("Unable to get your location. Please enter coordinates manually.");
          useLocationBtn.textContent = "Use My Location";
        }
      );
    });
  }

  // ---- Drag & drop ----

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { handleFiles(fileInput.files); fileInput.value = ""; });

  function handleFiles(list) {
    Array.from(list).forEach((f) => {
      if (!pendingFiles.some((p) => p.name === f.name && p.size === f.size)) {
        pendingFiles.push(f);
      }
    });
    renderFileList();
  }

  function renderFileList() {
    fileListEl.replaceChildren();
    pendingFiles.forEach((file, i) => {
      const li = document.createElement("li");
      li.className = "file-list-item";

      const n = document.createElement("span");
      n.className = "file-name";
      n.textContent = file.name;

      const s = document.createElement("span");
      s.className = "file-size";
      s.textContent = formatFileSize(file.size);

      const r = document.createElement("button");
      r.type = "button";
      r.className = "file-remove";
      r.textContent = "\u00D7";
      r.addEventListener("click", () => { pendingFiles.splice(i, 1); renderFileList(); });

      li.appendChild(n);
      li.appendChild(s);
      li.appendChild(r);
      fileListEl.appendChild(li);
    });
  }

  // ---- Submit ----

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const passport = document.getElementById("rpt-passport").value.trim();
    const name = document.getElementById("rpt-name").value.trim();
    const nationality = document.getElementById("rpt-nationality").value.trim();
    const date = document.getElementById("rpt-date").value;
    const classification = document.getElementById("rpt-classification").value;
    const summary = document.getElementById("rpt-summary").value.trim();
    const content = document.getElementById("rpt-content").value;
    const locationName = document.getElementById("rpt-location").value.trim();
    const latVal = document.getElementById("rpt-lat").value;
    const lngVal = document.getElementById("rpt-lng").value;
    const lat = latVal ? parseFloat(latVal) : null;
    const lng = lngVal ? parseFloat(lngVal) : null;

    // Read any newly added files
    const newAttachments = await Promise.all(pendingFiles.map(readFileAsAttachment));

    if (editingReportId) {
      // ---- EDIT existing report ----
      const existing = REPORTS.find((r) => r.id === editingReportId);
      if (existing) {
        existing.passportNumber = passport.toUpperCase();
        existing.subjectName = name;
        existing.nationality = nationality;
        existing.date = date;
        existing.classification = classification;
        existing.summary = summary;
        existing.locationName = locationName || null;
        existing.lat = lat;
        existing.lng = lng;
        existing.content = content || existing.content;

        // Append new files to existing attachments
        if (newAttachments.length > 0) {
          if (!existing.attachments) existing.attachments = [];
          existing.attachments.push(...newAttachments);
        }

        ActivityLog.log("report_edit", { reportId: existing.id, subject: existing.subjectName });
        try {
          await StorageDB.saveReport(existing);
          console.log("Report " + existing.id + " updated successfully.");
        } catch (err) {
          console.error("Failed to update report:", err);
          alert("Warning: Changes could not be saved to storage.\n\nError: " + err.message);
        }

        const id = editingReportId;
        closeModal();
        renderReportList(searchInput.value, countryFilter.value);
        openReport(id);
      }
    } else {
      // ---- CREATE new report ----
      const year = new Date().getFullYear();
      const seq = String(REPORTS.length + 1).padStart(4, "0");
      const id = "RPT-" + year + "-" + seq;

      const report = {
        id, passportNumber: passport.toUpperCase(), subjectName: name,
        nationality, date, classification, summary,
        locationName: locationName || null,
        lat: lat,
        lng: lng,
        content: content || "# Report: " + id + "\n\nNo detailed content provided.",
        attachments: newAttachments,
      };

      REPORTS.unshift(report);
      ActivityLog.log("report_create", { reportId: id, subject: name });

      try {
        await StorageDB.saveReport(report);
        console.log("Report " + id + " saved successfully.");
      } catch (err) {
        console.error("Failed to save report:", err);
        alert("Warning: Report created but could not be saved to persistent storage.\n\nError: " + err.message);
      }

      closeModal();
      renderReportList(searchInput.value, countryFilter.value);
      openReport(id);
    }
  });

  function readFileAsAttachment(file) {
    return new Promise((resolve) => {
      const att = {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        file: file, // Raw File object — uploaded to Firebase Storage on save
        textContent: null,
      };

      if (file.type.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".csv")) {
        const tr = new FileReader();
        tr.onload = () => { att.textContent = tr.result; resolve(att); };
        tr.onerror = () => resolve(att);
        tr.readAsText(file);
      } else {
        resolve(att);
      }
    });
  }

  // ---- Search & Country Filter ----
  searchInput.addEventListener("input", () => {
    renderReportList(searchInput.value, countryFilter.value);
    ActivityLog.logSearch(searchInput.value);
  });
  countryFilter.addEventListener("change", () => {
    renderReportList(searchInput.value, countryFilter.value);
  });

  // ---- Field Override Functions (inline editing of assessment fields) ----

  /**
   * Index all td.field-label elements in the iframe and apply any saved overrides.
   * Runs for ALL users so overrides are visible to everyone.
   */
  function applyFieldOverrides(iframe, report) {
    try {
      var iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;
      var labels = iframeDoc.querySelectorAll("td.field-label");
      for (var i = 0; i < labels.length; i++) {
        labels[i].setAttribute("data-field-idx", String(i));
        var valueCell = labels[i].nextElementSibling;
        if (valueCell && report.fieldOverrides && report.fieldOverrides[String(i)] != null) {
          setSafeHTML(valueCell, report.fieldOverrides[String(i)]);
        }
      }
    } catch (e) { /* cross-origin or missing doc */ }
  }

  /**
   * Make value cells contenteditable for admins with visual cues and save/discard UI.
   */
  function enableFieldEditing(iframe, report) {
    try {
      var iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      // Inject edit-mode styles into iframe
      var style = iframeDoc.createElement("style");
      style.textContent =
        "td[contenteditable='true'] { cursor: text; transition: border-color 0.15s, box-shadow 0.15s; border: 1px dashed transparent; border-radius: 3px; }" +
        "td[contenteditable='true']:hover { border-color: #3a9d5c88; }" +
        "td[contenteditable='true']:focus { outline: none; border-color: #3a9d5c; box-shadow: 0 0 0 2px rgba(58,157,92,0.25); background: rgba(58,157,92,0.06); }";
      iframeDoc.head.appendChild(style);

      var labels = iframeDoc.querySelectorAll("td.field-label");
      var dirtyFields = {};

      // Snapshot original values for change detection
      var originals = {};
      for (var i = 0; i < labels.length; i++) {
        var valueCell = labels[i].nextElementSibling;
        if (valueCell) {
          originals[String(i)] = valueCell.innerHTML;
          valueCell.setAttribute("contenteditable", "true");
        }
      }

      // Create save bar in parent (above iframe)
      var saveBar = document.createElement("div");
      saveBar.className = "field-edit-save-bar";
      saveBar.style.cssText =
        "display:none; position:sticky; top:0; z-index:50; background:#1e2230; border:1px solid #2e3340; border-radius:8px;" +
        "padding:10px 16px; margin-bottom:12px; align-items:center; justify-content:space-between; gap:12px; box-shadow:0 2px 8px rgba(0,0,0,0.3);";

      var msgSpan = document.createElement("span");
      msgSpan.style.cssText = "color:#e0e2e8; font-size:13px; font-weight:500;";
      msgSpan.textContent = "You have unsaved field changes";

      var btnGroup = document.createElement("div");
      btnGroup.style.cssText = "display:flex; gap:8px;";

      var discardBtn = document.createElement("button");
      discardBtn.type = "button";
      discardBtn.textContent = "Discard";
      discardBtn.style.cssText =
        "background:#2a2e38; color:#8b8fa4; border:1px solid #363b48; border-radius:5px; padding:6px 14px; cursor:pointer; font-size:12px; font-weight:500;";
      discardBtn.addEventListener("mouseenter", function () { discardBtn.style.borderColor = "#d94452"; discardBtn.style.color = "#d94452"; });
      discardBtn.addEventListener("mouseleave", function () { discardBtn.style.borderColor = "#363b48"; discardBtn.style.color = "#8b8fa4"; });

      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.textContent = "Save Changes";
      saveBtn.style.cssText =
        "background:#3a9d5c; color:#fff; border:none; border-radius:5px; padding:6px 14px; cursor:pointer; font-size:12px; font-weight:600;";
      saveBtn.addEventListener("mouseenter", function () { saveBtn.style.background = "#2f8a4e"; });
      saveBtn.addEventListener("mouseleave", function () { saveBtn.style.background = "#3a9d5c"; });

      btnGroup.appendChild(discardBtn);
      btnGroup.appendChild(saveBtn);
      saveBar.appendChild(msgSpan);
      saveBar.appendChild(btnGroup);

      // Insert save bar right before the iframe
      iframe.parentNode.insertBefore(saveBar, iframe);

      function checkDirty() {
        var hasDirty = false;
        for (var j = 0; j < labels.length; j++) {
          var vc = labels[j].nextElementSibling;
          if (vc && vc.innerHTML !== originals[String(j)]) {
            dirtyFields[String(j)] = true;
            hasDirty = true;
          } else {
            delete dirtyFields[String(j)];
          }
        }
        saveBar.style.display = hasDirty ? "flex" : "none";
      }

      // Listen for input on all editable value cells
      for (var k = 0; k < labels.length; k++) {
        var vc = labels[k].nextElementSibling;
        if (vc) {
          vc.addEventListener("input", checkDirty);
        }
      }

      // Discard: restore originals
      discardBtn.addEventListener("click", function () {
        for (var j = 0; j < labels.length; j++) {
          var vc = labels[j].nextElementSibling;
          if (vc) {
            setSafeHTML(vc, originals[String(j)]);
          }
        }
        dirtyFields = {};
        saveBar.style.display = "none";
      });

      // Save: build overrides map, persist via StorageDB
      saveBtn.addEventListener("click", function () {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";

        var overrides = report.fieldOverrides ? Object.assign({}, report.fieldOverrides) : {};
        for (var j = 0; j < labels.length; j++) {
          var vc = labels[j].nextElementSibling;
          if (vc && dirtyFields[String(j)]) {
            overrides[String(j)] = vc.innerHTML;
          }
        }
        report.fieldOverrides = overrides;

        StorageDB.saveReport(report).then(function () {
          // Update originals to new values
          for (var j = 0; j < labels.length; j++) {
            var vc = labels[j].nextElementSibling;
            if (vc) originals[String(j)] = vc.innerHTML;
          }
          dirtyFields = {};
          saveBar.style.display = "none";
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";

          // Brief success flash
          saveBar.style.display = "flex";
          msgSpan.textContent = "Changes saved successfully";
          msgSpan.style.color = "#3a9d5c";
          setTimeout(function () {
            saveBar.style.display = "none";
            msgSpan.textContent = "You have unsaved field changes";
            msgSpan.style.color = "#e0e2e8";
          }, 2000);

          ActivityLog.log("field_overrides_saved", { reportId: report.id, fieldCount: Object.keys(overrides).length });
        }).catch(function (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
          msgSpan.textContent = "Save failed — please try again";
          msgSpan.style.color = "#d94452";
          setTimeout(function () {
            msgSpan.textContent = "You have unsaved field changes";
            msgSpan.style.color = "#e0e2e8";
          }, 3000);
        });
      });

    } catch (e) { /* cross-origin or missing doc */ }
  }

  // ---- Init ----
  // Wait for admin check so top-secret filtering is applied on first render
  await adminReady;
  renderReportList("", "");
})();
