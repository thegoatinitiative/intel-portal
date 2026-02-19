/**
 * dashboard.js — Executive Briefing Dashboard
 * Auto-expands all documents for immediate review.
 * Uses DOMPurify for XSS protection. Persists via IndexedDB.
 */

(async function () {
  "use strict";

  await requireAuth();

  // Show Admin tab if user is admin
  isAdmin().then(function (admin) {
    if (admin) {
      var adminTab = document.getElementById("admin-tab");
      if (adminTab) adminTab.hidden = false;
    }
  });

  const session = getSession();
  const userDisplay = document.getElementById("user-display");
  if (session && userDisplay) {
    userDisplay.textContent = session.username.toUpperCase();
  }

  const reportListEl = document.getElementById("report-list");
  const searchInput = document.getElementById("search-input");
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

  // ---- Load from IndexedDB (with timeout to prevent hang) ----
  try {
    const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 3000));
    const saved = await Promise.race([StorageDB.getAllReports(), dbTimeout]);
    if (saved && saved.length > 0) {
      REPORTS.length = 0;
      REPORTS.push(...saved);
      console.log("Loaded " + saved.length + " report(s) from storage.");
    }
  } catch (e) {
    console.error("Failed to load from IndexedDB:", e);
  }

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

  async function renderPDFPages(dataUrl, container) {
    // Show loading state
    const loading = document.createElement("div");
    loading.style.cssText = "padding:2rem;text-align:center;color:var(--text-muted);font-size:0.9rem;";
    loading.textContent = "Rendering PDF pages...";
    container.appendChild(loading);

    try {
      // Wait for PDF.js to load
      if (window.pdfjsReady) await window.pdfjsReady;
      if (!window.pdfjsLib) throw new Error("PDF.js not available");

      // Convert data URL to binary
      const raw = atob(dataUrl.split(",")[1]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      container.removeChild(loading);

      const totalPages = pdf.numPages;
      for (let num = 1; num <= totalPages; num++) {
        const page = await pdf.getPage(num);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = "width:100%;height:auto;display:block;";

        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        container.appendChild(canvas);

        // Page separator
        if (num < totalPages) {
          const sep = document.createElement("div");
          sep.style.cssText = "height:2px;background:var(--border);";
          container.appendChild(sep);
        }
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

  function renderReportList(filter) {
    const query = (filter || "").toLowerCase();
    reportListEl.replaceChildren();

    const filtered = REPORTS.filter((r) => {
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

    filtered.forEach((r) => reportListEl.appendChild(buildReportListItem(r)));
  }

  // ---- Report Viewer (executive layout, auto-expanded docs) ----

  function openReport(id) {
    const report = REPORTS.find((r) => r.id === id);
    if (!report) return;

    activeReportId = id;
    ActivityLog.log("report_view", { reportId: report.id, subject: report.subjectName });
    renderReportList(searchInput.value);

    reportPlaceholder.hidden = true;
    reportContentEl.hidden = false;

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

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-action";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editReport(report));
    actionsDiv.appendChild(editBtn);

    const printBtn = document.createElement("button");
    printBtn.type = "button";
    printBtn.className = "btn-action";
    printBtn.textContent = "Print";
    printBtn.addEventListener("click", () => { ActivityLog.log("report_export", { reportId: report.id, method: "print" }); printReport(); });
    actionsDiv.appendChild(printBtn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-action";
    saveBtn.textContent = "Save PDF";
    saveBtn.addEventListener("click", () => { ActivityLog.log("report_export", { reportId: report.id, method: "pdf" }); saveReportPDF(report); });
    actionsDiv.appendChild(saveBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => confirmDelete(report));
    actionsDiv.appendChild(deleteBtn);

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

      if (label === "Classification") {
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
            report.attachments.splice(idx, 1);
            StorageDB.saveReport(report).then(function () {
              openReport(report.id);
            });
          }
        });

        embedHeader.appendChild(icon);
        embedHeader.appendChild(nameEl);
        embedHeader.appendChild(sizeEl);
        embedHeader.appendChild(removeBtn);
        embed.appendChild(embedHeader);

        // Body — auto-expanded
        const body = document.createElement("div");
        body.className = "document-embed-body";

        if (att.type === "application/pdf") {
          renderPDFPages(att.dataUrl, body);
        } else if (att.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = att.dataUrl;
          img.alt = att.name;
          body.appendChild(img);
        } else if (
          att.type.startsWith("text/") ||
          att.name.endsWith(".md") ||
          att.name.endsWith(".csv")
        ) {
          const pre = document.createElement("pre");
          pre.textContent = att.textContent || "(Unable to read file)";
          body.appendChild(pre);
        } else {
          const dl = document.createElement("div");
          dl.style.cssText = "padding:1.5rem;text-align:center;";
          const link = document.createElement("a");
          link.href = att.dataUrl;
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
  }

  // ---- Print Report ----

  function printReport() {
    window.print();
  }

  // ---- Save as PDF (opens clean page with print/save dialog) ----

  function saveReportPDF(report) {
    const content = reportContentEl.cloneNode(true);
    // Remove action buttons from the clone
    const actions = content.querySelector(".report-header-actions");
    if (actions) actions.remove();

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to save the report.");
      return;
    }

    const doc = printWindow.document;
    doc.open();

    // Build head
    const head = doc.head;
    const titleEl = doc.createElement("title");
    titleEl.textContent = report.id + " - " + report.subjectName;
    head.appendChild(titleEl);

    const style = doc.createElement("style");
    style.textContent = [
      "*{box-sizing:border-box;margin:0;padding:0}",
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;line-height:1.6;padding:2rem;max-width:900px;margin:0 auto}",
      "h1{font-size:1.5rem;margin-bottom:0.25rem}",
      ".report-title-id{font-family:monospace;font-size:0.85rem;color:#666;margin-bottom:1.5rem}",
      ".report-header-banner{border:2px solid #ddd;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem}",
      ".report-header-banner::before{display:none}",
      ".report-meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;padding-top:1rem;border-top:1px solid #ddd}",
      ".meta-item{display:flex;flex-direction:column;gap:0.15rem}",
      ".meta-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:600}",
      ".meta-value{font-size:0.9rem;font-weight:600;color:#1a1a2e}",
      ".meta-value.mono{font-family:monospace;color:#2563eb}",
      ".report-item-classification{display:inline-block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:0.2rem 0.6rem;border-radius:4px;border:1px solid #999}",
      ".report-body-section{border:1px solid #ddd;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;line-height:1.8}",
      ".report-body-section h1,.report-body-section h2,.report-body-section h3{border-bottom:1px solid #ddd;padding-bottom:0.4rem;margin-top:1.25rem;margin-bottom:0.5rem}",
      ".report-body-section h1:first-child{margin-top:0}",
      ".report-body-section p{margin-bottom:0.75rem;color:#444}",
      ".report-body-section table{width:100%;border-collapse:collapse;margin:1rem 0}",
      ".report-body-section th,.report-body-section td{padding:0.5rem 0.75rem;border:1px solid #ddd;text-align:left;font-size:0.85rem}",
      ".report-body-section th{background:#f5f5f5;font-weight:600;text-transform:uppercase;font-size:0.72rem}",
      ".report-body-section blockquote{border-left:3px solid #2563eb;padding:0.5rem 1rem;margin:1rem 0;background:#f0f4ff}",
      ".documents-section-header{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;color:#888;font-weight:600;margin:1.5rem 0 1rem;padding-bottom:0.5rem;border-bottom:1px solid #ddd}",
      ".document-embed{border:1px solid #ddd;border-radius:8px;overflow:hidden;margin-bottom:1.5rem;page-break-inside:avoid}",
      ".document-embed-header{display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1rem;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:0.85rem;font-weight:600}",
      ".document-embed-size{color:#888;font-size:0.72rem;font-weight:400}",
      ".document-embed-body canvas{width:100%;height:auto;display:block}",
      ".document-embed-body img{max-width:100%;display:block}",
      "canvas{max-width:100%;height:auto!important}",
      "@media print{body{padding:0.5rem}canvas{max-width:100%;height:auto!important;page-break-inside:avoid}}",
    ].join("\n");
    head.appendChild(style);

    // Append cloned content to body
    doc.body.appendChild(doc.adoptNode(content));
    doc.close();

    // Wait for rendering then trigger print
    setTimeout(function() {
      printWindow.print();
    }, 1500);
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
      renderReportList(searchInput.value);
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
        renderReportList(searchInput.value);
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
        console.log("Report " + id + " saved to IndexedDB successfully.");
      } catch (err) {
        console.error("Failed to save report:", err);
        alert("Warning: Report created but could not be saved to persistent storage.\n\nError: " + err.message);
      }

      closeModal();
      renderReportList(searchInput.value);
      openReport(id);
    }
  });

  function readFileAsAttachment(file) {
    return new Promise((resolve) => {
      const att = {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        dataUrl: null,
        textContent: null,
      };

      if (file.type.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".csv")) {
        const tr = new FileReader();
        tr.onload = () => { att.textContent = tr.result; };
        tr.readAsText(file);
      }

      const reader = new FileReader();
      reader.onload = () => { att.dataUrl = reader.result; resolve(att); };
      reader.onerror = () => resolve(att);
      reader.readAsDataURL(file);
    });
  }

  // ---- Search ----
  searchInput.addEventListener("input", () => {
    renderReportList(searchInput.value);
    ActivityLog.logSearch(searchInput.value);
  });

  // ---- Init ----
  renderReportList("");
})();
