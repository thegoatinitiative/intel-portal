/**
 * auth.js — Firebase Authentication for Intel Portal
 * Uses Firebase Auth with email/password (username@intelportal.app convention).
 */

const AUTH_KEY = "intel_portal_session";
const EMAIL_DOMAIN = "@intelportal.app";
const TGI_ACCESS_ORIGIN = "https://www.thegoatinitiative.org";
var signupInProgress = false;
var setupToken = "";
var SETUP_KEY = "intel_portal_setup";
try {
  var setupParam = new URLSearchParams(window.location.search).get("setup") || "";
  if (/^[A-Za-z0-9_-]{20,200}$/.test(setupParam)) {
    setupToken = setupParam;
    sessionStorage.setItem(SETUP_KEY, setupToken);
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  } else {
    var storedSetup = sessionStorage.getItem(SETUP_KEY) || "";
    if (/^[A-Za-z0-9_-]{20,200}$/.test(storedSetup)) setupToken = storedSetup;
  }
  if (setupToken) signupInProgress = true;
} catch (err) {
  setupToken = "";
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setSession(username, role) {
  sessionStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ username: username, role: role || "analyst", timestamp: Date.now() })
  );
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
}

/**
 * requireAuth — returns a Promise that resolves when the user is confirmed
 * authenticated. Redirects to index.html if not logged in.
 */
function requireAuth() {
  return new Promise(function (resolve) {
    // If we already have a session and Firebase is still initializing, resolve fast
    const existing = getSession();

    fbAuth.onAuthStateChanged(function (user) {
      if (user) {
        // User is signed in — ensure session is populated
        if (!existing) {
          var username = user.email.replace(EMAIL_DOMAIN, "");
          // Fetch role from Firestore
          fbDb.collection("users").doc(user.uid).get().then(function (doc) {
            var role = doc.exists ? doc.data().role : "analyst";
            setSession(username, role);
            resolve(user);
          }).catch(function () {
            setSession(username, "analyst");
            resolve(user);
          });
        } else {
          resolve(user);
        }
      } else {
        // Not signed in — redirect to login (unless already on login page)
        clearSession();
        var path = window.location.pathname;
        var isLoginPage = path.endsWith("index.html") || path.endsWith("/") || path === "/";
        if (!isLoginPage) {
          window.location.href = "index.html";
        }
        resolve(null);
      }
    });
  });
}

/**
 * isAdmin — checks if current user has admin role.
 * Returns a Promise<boolean>.
 */
function isAdmin() {
  // Check session cache first
  var session = getSession();
  if (session && session.role === "admin") return Promise.resolve(true);

  var user = fbAuth.currentUser;
  if (!user) return Promise.resolve(false);

  return fbDb.collection("users").doc(user.uid).get().then(function (doc) {
    if (doc.exists && doc.data().role === "admin") {
      // Update session cache
      if (session) {
        session.role = "admin";
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
      }
      return true;
    }
    return false;
  }).catch(function () {
    return false;
  });
}

function showAccessWall(status) {
  document.body.className = "login-body";
  document.body.style.minHeight = "100vh";
  document.body.textContent = "";

  var box = document.createElement("div");
  box.className = "login-container";
  var header = document.createElement("div");
  header.className = "login-header";
  var title = document.createElement("h1");
  var subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  if (status === "denied") {
    title.textContent = "ACCESS DENIED";
    subtitle.textContent = "This account was not approved. Detailed files stay closed.";
  } else if (status === "error") {
    title.textContent = "APPROVAL CHECK FAILED";
    subtitle.textContent = "The approval check did not answer. Detailed files stay closed until it does.";
  } else {
    title.textContent = "WAITING FOR APPROVAL";
    subtitle.textContent = "Detailed files open after this account is approved.";
  }
  header.appendChild(title);
  header.appendChild(subtitle);
  box.appendChild(header);

  var note = document.createElement("p");
  note.className = "form-note";
  note.hidden = true;
  box.appendChild(note);

  if (status === "pending") {
    var again = document.createElement("button");
    again.type = "button";
    again.className = "btn-login";
    again.textContent = "Check again";
    again.addEventListener("click", function () {
      window.location.reload();
    });
    box.appendChild(again);

    var resend = document.createElement("button");
    resend.type = "button";
    resend.className = "link-button";
    resend.style.display = "block";
    resend.style.margin = "1rem auto 0";
    resend.textContent = "Send the request again";
    resend.addEventListener("click", function () {
      var user = fbAuth.currentUser;
      if (!user) return;
      resend.disabled = true;
      user.getIdToken(true).then(function (token) {
        return fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        });
      }).then(function (response) {
        return response.json().then(function (body) {
          note.hidden = false;
          if (!response.ok) note.textContent = "The email did not send. Try again in a minute.";
          else if (body && body.mailed) note.textContent = "Sent again. The approval email is on its way.";
          else note.textContent = "The request is already waiting.";
        });
      }).catch(function () {
        note.hidden = false;
        note.textContent = "The email did not send. Try again in a minute.";
      }).then(function () {
        resend.disabled = false;
      });
    });
    box.appendChild(resend);
  } else {
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn-login";
    retry.textContent = status === "error" ? "Try again" : "Back to sign in";
    retry.addEventListener("click", function () {
      if (status === "error") {
        window.location.reload();
        return;
      }
      fbAuth.signOut().then(function () {
        clearSession();
        window.location.href = "index.html";
      });
    });
    box.appendChild(retry);
  }

  var signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "link-button";
  signOut.style.display = "block";
  signOut.style.margin = "1rem auto 0";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", function () {
    fbAuth.signOut().then(function () {
      clearSession();
      window.location.href = "index.html";
    });
  });
  box.appendChild(signOut);
  document.body.appendChild(box);
}

function fetchAccessStatus(user) {
  return user.getIdToken(true).then(function (token) {
    return fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/status", {
      headers: { Authorization: "Bearer " + token },
    });
  }).then(function (response) {
    if (!response.ok) return "error";
    return response.json().then(function (body) {
      if (
        body &&
        (body.status === "approved" ||
          body.status === "pending" ||
          body.status === "denied")
      ) {
        return body.status;
      }
      return "error";
    });
  }).catch(function () {
    return "error";
  });
}

function confirmAdmin(user) {
  return fbDb.collection("users").doc(user.uid).get().then(function (doc) {
    return !!(doc.exists && doc.data().role === "admin");
  }).catch(function () {
    return false;
  });
}

/**
 * requireDetailedAccess — signed-in admins and already-approved accounts continue.
 * A new public account waits until The GOAT Initiative approves it.
 * Returns the Firebase user, or null when the page should stop.
 */
function requireDetailedAccess() {
  return requireAuth().then(function (user) {
    if (!user) return null;
    return confirmAdmin(user).then(function (admin) {
      if (admin) return user;
      return fetchAccessStatus(user).then(function (status) {
        if (status === "approved") return user;
        showAccessWall(status === "pending" ? "pending" : status === "error" ? "error" : "denied");
        return null;
      });
    });
  });
}

/**
 * showChangePasswordModal — Forces a new user to set their own password.
 */
function showChangePasswordModal(user) {
  var modal = document.getElementById("change-password-modal");
  if (!modal) return;
  modal.hidden = false;

  var form = document.getElementById("change-password-form");
  var errorEl = document.getElementById("change-password-error");
  var submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var newPass = document.getElementById("new-pass").value;
    var confirmPass = document.getElementById("confirm-pass").value;
    errorEl.hidden = true;

    if (newPass.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters.";
      errorEl.hidden = false;
      return;
    }
    if (newPass !== confirmPass) {
      errorEl.textContent = "Passwords do not match.";
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating...";

    user.updatePassword(newPass).then(function () {
      return fbDb.collection("users").doc(user.uid).update({ mustChangePassword: false });
    }).then(function () {
      window.location.href = "dashboard.html";
    }).catch(function (err) {
      errorEl.textContent = err.message || "Failed to update password.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Set Password";
    });
  });
}

// ---- Login form handler ----
var loginForm = document.getElementById("login-form");
if (loginForm) {
  // If already authenticated, go to dashboard
  fbAuth.onAuthStateChanged(function (user) {
    if (signupInProgress) return;
    if (user) {
      fbDb.collection("users").doc(user.uid).get().then(function (doc) {
        if (doc.exists && doc.data().mustChangePassword) {
          showChangePasswordModal(user);
        } else {
          window.location.href = "dashboard.html";
        }
      });
    }
  });

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var username = document.getElementById("username").value.trim().toLowerCase();
    var password = document.getElementById("password").value;
    var errorMsg = document.getElementById("error-msg");
    var submitBtn = loginForm.querySelector('button[type="submit"]');

    // Disable button during auth
    submitBtn.disabled = true;
    submitBtn.textContent = "Authenticating...";
    errorMsg.hidden = true;

    var email = username + EMAIL_DOMAIN;

    fbAuth.signInWithEmailAndPassword(email, password)
      .then(function (cred) {
        // Fetch user doc for role + mustChangePassword flag
        return fbDb.collection("users").doc(cred.user.uid).get().then(function (doc) {
          var data = doc.exists ? doc.data() : {};
          var role = data.role || "analyst";
          setSession(username, role);
          ActivityLog.log("login", { username: username });

          if (data.mustChangePassword) {
            showChangePasswordModal(cred.user);
          } else {
            window.location.href = "dashboard.html";
          }
        });
      })
      .catch(function () {
        errorMsg.hidden = false;
        document.getElementById("password").value = "";
        document.getElementById("password").focus();
        submitBtn.disabled = false;
        submitBtn.textContent = "Authenticate";
      });
  });
}

// ---- One-time login setup after a request is approved. ----
var setupForm = document.getElementById("setup-form");
if (setupForm && setupToken) {
  var loginFormEl = document.getElementById("login-form");
  var requestAccess = document.getElementById("request-access");
  setupForm.hidden = false;
  if (loginFormEl) loginFormEl.hidden = true;
  if (requestAccess) requestAccess.hidden = true;

  setupForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var username = document.getElementById("setup-username").value.trim().toLowerCase();
    var password = document.getElementById("setup-password").value;
    var confirmPass = document.getElementById("setup-confirm").value;
    var errorEl = document.getElementById("setup-error");
    var submitBtn = setupForm.querySelector('button[type="submit"]');
    var createdUid = null;
    var token = setupToken;

    function fail(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Create login";
      signupInProgress = true;
    }

    errorEl.hidden = true;
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) {
      fail("Use a username of 2 to 32 letters or numbers.");
      return;
    }
    if (password.length < 10 || password.length > 200) {
      fail("Use a password of at least 10 characters.");
      return;
    }
    if (password !== confirmPass) {
      fail("Those passwords do not match.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
    signupInProgress = true;

    fbAuth.signOut().catch(function () {}).then(function () {
      return fbAuth.createUserWithEmailAndPassword(username + EMAIL_DOMAIN, password);
    }).then(function (cred) {
      createdUid = cred.user.uid;
      return cred.user.getIdToken(true).then(function (idToken) {
        return fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: idToken, setupToken: token }),
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (response.ok) return body;
            return cred.user.delete().catch(function () {}).then(function () {
              return fbAuth.signOut();
            }).then(function () {
              var err = new Error("finish");
              err.code = body && body.error ? body.error : "request";
              throw err;
            });
          });
        });
      }).then(function () {
        setSession(username, "analyst");
        setupToken = "";
        try { sessionStorage.removeItem(SETUP_KEY); } catch (err) {}
        return fbDb.collection("users").doc(cred.user.uid).set({
          username: username,
          role: "analyst",
          mustChangePassword: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch(function () {});
      }).then(function () {
        window.location.href = "dashboard.html";
      });
    }).catch(function (err) {
      var message = "The login could not be created. Try again.";
      if (err && err.code === "auth/email-already-in-use") message = "That username is already taken.";
      else if (err && err.code === "auth/operation-not-allowed") message = "New logins are not open on this site yet.";
      else if (err && err.code === "auth/weak-password") message = "Use a password of at least 10 characters.";
      else if (err && err.code === "rate") message = "Too many attempts. Wait a few minutes and try again.";
      else if (err && err.code === "expired") message = "This link has expired. Submit the request again to get a new one.";
      else if (err && err.code === "invalid") message = "This link is invalid or was already used.";
      if (err && (err.code === "expired" || err.code === "invalid")) {
        setupToken = "";
        try { sessionStorage.removeItem(SETUP_KEY); } catch (ignore) {}
      }
      else if (err && err.code === "taken") message = "That login is already in use. Choose another username.";
      else if (err && err.code === "request" || (err && err.code === "store") || (err && err.code === "unavailable")) {
        message = "The login was not saved. Try again.";
      }
      var cleanup = Promise.resolve();
      if (createdUid && fbAuth.currentUser && fbAuth.currentUser.uid === createdUid) {
        cleanup = fbAuth.currentUser.delete().catch(function () {}).then(function () {
          return fbAuth.signOut();
        });
      }
      cleanup.then(function () {
        fail(message);
      });
    });
  });
}

// ---- Logout handler ----
var logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", function () {
    ActivityLog.log("logout");
    fbAuth.signOut().then(function () {
      clearSession();
      window.location.href = "index.html";
    });
  });
}
