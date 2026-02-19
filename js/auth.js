/**
 * auth.js — Firebase Authentication for Intel Portal
 * Uses Firebase Auth with email/password (username@intelportal.app convention).
 */

const AUTH_KEY = "intel_portal_session";
const EMAIL_DOMAIN = "@intelportal.app";

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

// ---- Login form handler ----
var loginForm = document.getElementById("login-form");
if (loginForm) {
  // If already authenticated, go to dashboard
  fbAuth.onAuthStateChanged(function (user) {
    if (user) {
      window.location.href = "dashboard.html";
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
        // Fetch user doc for role
        return fbDb.collection("users").doc(cred.user.uid).get().then(function (doc) {
          var role = doc.exists ? doc.data().role : "analyst";
          setSession(username, role);
          ActivityLog.log("login", { username: username });
          window.location.href = "dashboard.html";
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
