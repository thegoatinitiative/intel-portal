/**
 * admin.js — Admin dashboard for Intel Portal
 * User management + real-time activity feed.
 */

(async function () {
  "use strict";

  await requireAuth();

  // Enforce admin role
  var admin = await isAdmin();
  if (!admin) {
    window.location.href = "dashboard.html";
    return;
  }

  var session = getSession();
  var userDisplay = document.getElementById("user-display");
  if (session && userDisplay) {
    userDisplay.textContent = session.username.toUpperCase();
  }

  // ---- User Management ----

  var addUserBtn = document.getElementById("add-user-btn");
  var addUserForm = document.getElementById("add-user-form");
  var cancelAddUser = document.getElementById("cancel-add-user");
  var createUserForm = document.getElementById("create-user-form");
  var createUserMsg = document.getElementById("create-user-msg");
  var usersTbody = document.getElementById("users-tbody");
  var filterUserSelect = document.getElementById("filter-user");

  addUserBtn.addEventListener("click", function () {
    addUserForm.hidden = false;
  });

  cancelAddUser.addEventListener("click", function () {
    addUserForm.hidden = true;
    createUserForm.reset();
    createUserMsg.hidden = true;
  });

  function showMsg(text, isError) {
    createUserMsg.textContent = text;
    createUserMsg.className = "admin-msg" + (isError ? " admin-msg-error" : " admin-msg-success");
    createUserMsg.hidden = false;
  }

  function clearTable(tbody) {
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  }

  function setEmptyRow(tbody, text) {
    clearTable(tbody);
    var tr = document.createElement("tr");
    var td = document.createElement("td");
    td.colSpan = 3;
    td.style.textAlign = "center";
    td.style.color = "var(--text-muted)";
    td.textContent = text;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // Load users from Firestore
  function loadUsers() {
    fbDb.collection("users").orderBy("createdAt", "desc").get().then(function (snap) {
      clearTable(usersTbody);

      // Reset filter dropdown
      while (filterUserSelect.options.length > 1) filterUserSelect.remove(1);

      if (snap.empty) {
        setEmptyRow(usersTbody, "No users found.");
        return;
      }

      snap.forEach(function (doc) {
        var d = doc.data();
        var tr = document.createElement("tr");

        var tdUser = document.createElement("td");
        tdUser.textContent = d.username || "\u2014";
        tdUser.style.fontFamily = "var(--font-mono)";

        var tdRole = document.createElement("td");
        var roleBadge = document.createElement("span");
        roleBadge.className = "admin-role-badge admin-role-" + (d.role || "analyst");
        roleBadge.textContent = (d.role || "analyst").toUpperCase();
        tdRole.appendChild(roleBadge);

        var tdCreated = document.createElement("td");
        if (d.createdAt && d.createdAt.toDate) {
          tdCreated.textContent = d.createdAt.toDate().toLocaleDateString();
        } else {
          tdCreated.textContent = "\u2014";
        }

        var tdActions = document.createElement("td");
        // Don't allow deleting yourself
        var currentUser = fbAuth.currentUser;
        if (currentUser && doc.id !== currentUser.uid) {
          var delBtn = document.createElement("button");
          delBtn.className = "btn-delete";
          delBtn.textContent = "Remove";
          delBtn.style.cssText = "padding:0.3rem 0.8rem;font-size:0.65rem;";
          delBtn.addEventListener("click", function () {
            confirmDeleteUser(doc.id, d.username);
          });
          tdActions.appendChild(delBtn);
        }

        tr.appendChild(tdUser);
        tr.appendChild(tdRole);
        tr.appendChild(tdCreated);
        tr.appendChild(tdActions);
        usersTbody.appendChild(tr);

        // Add to filter dropdown
        var opt = document.createElement("option");
        opt.value = d.username;
        opt.textContent = d.username;
        filterUserSelect.appendChild(opt);
      });
    });
  }

  function confirmDeleteUser(uid, username) {
    var overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    var box = document.createElement("div");
    box.className = "confirm-box";
    var h3 = document.createElement("h3");
    h3.textContent = "Remove User";
    var p = document.createElement("p");
    p.textContent = "Remove user '" + username + "'? They will no longer be able to log in.";
    var actions = document.createElement("div");
    actions.className = "confirm-actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function () { overlay.remove(); });
    var confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-confirm-delete";
    confirmBtn.textContent = "Remove";
    confirmBtn.addEventListener("click", function () {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Removing...";
      // Delete Firestore user doc
      fbDb.collection("users").doc(uid).delete().then(function () {
        overlay.remove();
        loadUsers();
      }).catch(function (err) {
        alert("Error removing user: " + err.message);
        overlay.remove();
      });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(h3);
    box.appendChild(p);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  loadUsers();

  // Create user via secondary Firebase app (avoids signing out admin)
  createUserForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var username = document.getElementById("new-username").value.trim().toLowerCase();
    var password = document.getElementById("new-password").value;
    var role = document.getElementById("new-role").value;

    if (username.length < 2) {
      showMsg("Username must be at least 2 characters.", true);
      return;
    }
    if (password.length < 6) {
      showMsg("Password must be at least 6 characters.", true);
      return;
    }

    var submitBtn = createUserForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    var email = username + "@intelportal.app";

    // Use a secondary app instance to avoid signing out the current admin
    var secondaryApp;
    try {
      secondaryApp = firebase.app("secondary");
    } catch (e) {
      secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");
    }
    var secondaryAuth = secondaryApp.auth();

    secondaryAuth.createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        // Write user doc to Firestore
        return fbDb.collection("users").doc(cred.user.uid).set({
          username: username,
          role: role,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).then(function () {
          // Sign out the secondary app user
          return secondaryAuth.signOut();
        });
      })
      .then(function () {
        showMsg("User '" + username + "' created successfully.", false);
        createUserForm.reset();
        loadUsers();
      })
      .catch(function (err) {
        var msg = "Failed to create user.";
        if (err.code === "auth/email-already-in-use") {
          msg = "Username '" + username + "' already exists.";
        } else if (err.code === "auth/weak-password") {
          msg = "Password is too weak (minimum 6 characters).";
        } else if (err.message) {
          msg = err.message;
        }
        showMsg(msg, true);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create";
      });
  });

  // ---- Activity Feed ----

  var activityFeed = document.getElementById("activity-feed");
  var filterAction = document.getElementById("filter-action");
  var filterDate = document.getElementById("filter-date");
  var applyFilters = document.getElementById("apply-filters");
  var currentUnsubscribe = null;

  function formatTimestamp(ts) {
    if (!ts || !ts.toDate) return "\u2014";
    var d = ts.toDate();
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
  }

  function getActionBadgeClass(action) {
    var map = {
      login: "admin-action-login",
      logout: "admin-action-logout",
      report_view: "admin-action-view",
      report_create: "admin-action-create",
      report_edit: "admin-action-edit",
      report_delete: "admin-action-delete",
      report_export: "admin-action-export",
      search: "admin-action-search",
    };
    return map[action] || "admin-action-default";
  }

  function renderActivityItem(data) {
    var div = document.createElement("div");
    div.className = "admin-activity-item";

    var badge = document.createElement("span");
    badge.className = "admin-action-badge " + getActionBadgeClass(data.action);
    badge.textContent = (data.action || "unknown").replace("_", " ");

    var user = document.createElement("span");
    user.className = "admin-activity-user";
    user.textContent = data.username || "unknown";

    var details = document.createElement("span");
    details.className = "admin-activity-details";
    if (data.details) {
      var parts = [];
      if (data.details.reportId) parts.push(data.details.reportId);
      if (data.details.subject) parts.push(data.details.subject);
      if (data.details.query) parts.push('"' + data.details.query + '"');
      if (data.details.method) parts.push(data.details.method);
      details.textContent = parts.join(" \u2014 ");
    }

    var time = document.createElement("span");
    time.className = "admin-activity-time";
    time.textContent = formatTimestamp(data.timestamp);

    div.appendChild(badge);
    div.appendChild(user);
    div.appendChild(details);
    div.appendChild(time);

    return div;
  }

  function setFeedMessage(text, color) {
    while (activityFeed.firstChild) activityFeed.removeChild(activityFeed.firstChild);
    var div = document.createElement("div");
    div.style.cssText = "text-align:center;padding:2rem;color:" + (color || "var(--text-muted)") + ";";
    div.textContent = text;
    activityFeed.appendChild(div);
  }

  function subscribeToActivity() {
    // Unsubscribe from previous listener
    if (currentUnsubscribe) currentUnsubscribe();

    var userFilter = filterUserSelect.value;
    var actionFilter = filterAction.value;
    var dateFilter = filterDate.value;

    // Build query based on filters
    var query;
    if (userFilter && actionFilter) {
      query = fbDb.collection("activity")
        .where("username", "==", userFilter)
        .where("action", "==", actionFilter)
        .orderBy("timestamp", "desc")
        .limit(50);
    } else if (userFilter) {
      query = fbDb.collection("activity")
        .where("username", "==", userFilter)
        .orderBy("timestamp", "desc")
        .limit(50);
    } else if (actionFilter) {
      query = fbDb.collection("activity")
        .where("action", "==", actionFilter)
        .orderBy("timestamp", "desc")
        .limit(50);
    } else {
      query = fbDb.collection("activity")
        .orderBy("timestamp", "desc")
        .limit(50);
    }

    currentUnsubscribe = query.onSnapshot(function (snap) {
      while (activityFeed.firstChild) activityFeed.removeChild(activityFeed.firstChild);

      if (snap.empty) {
        setFeedMessage("No activity found.");
        return;
      }

      snap.forEach(function (doc) {
        var data = doc.data();

        // Client-side date filter
        if (dateFilter && data.timestamp && data.timestamp.toDate) {
          var eventDate = data.timestamp.toDate();
          var filterDateObj = new Date(dateFilter);
          if (eventDate < filterDateObj) return;
        }

        activityFeed.appendChild(renderActivityItem(data));
      });
    }, function (err) {
      console.error("Activity feed error:", err);
      setFeedMessage("Error loading activity: " + err.message, "var(--danger)");
    });
  }

  // Initial subscription
  subscribeToActivity();

  // Re-subscribe on filter change
  applyFilters.addEventListener("click", subscribeToActivity);

})();
