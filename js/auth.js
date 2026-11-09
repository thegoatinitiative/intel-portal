/**
 * auth.js — Firebase Authentication for Intel Portal
 * Uses Firebase Auth with email/password (username@intelportal.app convention).
 */

const AUTH_KEY = "intel_portal_session";
const EMAIL_DOMAIN = "@intelportal.app";
const TGI_ACCESS_ORIGIN = "https://www.thegoatinitiative.org";
var signupInProgress = false;
var setupToken = "";
var recoverToken = "";
var SETUP_KEY = "intel_portal_setup";
var RECOVER_KEY = "intel_portal_recover";
var TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

function keepToken(param, storageKey) {
  if (TOKEN_SHAPE.test(param)) {
    try { sessionStorage.setItem(storageKey, param); } catch (err) {}
    return param;
  }
  try {
    var stored = sessionStorage.getItem(storageKey) || "";
    if (TOKEN_SHAPE.test(stored)) return stored;
  } catch (err) {}
  return "";
}

try {
  var searchParams = new URLSearchParams(window.location.search);
  setupToken = keepToken(searchParams.get("setup") || "", SETUP_KEY);
  recoverToken = setupToken ? "" : keepToken(searchParams.get("recover") || "", RECOVER_KEY);
  if ((setupToken && searchParams.get("setup")) || (recoverToken && searchParams.get("recover"))) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  if (setupToken || recoverToken) signupInProgress = true;
} catch (err) {
  setupToken = "";
  recoverToken = "";
}

function accountName(data, email) {
  var fromEmail = String(email || "").toLowerCase().replace(EMAIL_DOMAIN, "");
  var fromDoc = data && typeof data.username === "string" ? data.username.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(fromDoc)) return fromEmail;
  if ((fromDoc === "admin" || fromDoc === "cgautereaux") && fromDoc !== fromEmail) return fromEmail;
  return fromDoc;
}

function lookupAuthEmail(username) {
  var fallback = username + EMAIL_DOMAIN;
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
  return fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/auth-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username }),
    signal: controller ? controller.signal : undefined,
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      var email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      var local = email.endsWith(EMAIL_DOMAIN) ? email.slice(0, -EMAIL_DOMAIN.length) : "";
      if (/^[a-z0-9][a-z0-9._-]{1,31}$/.test(local)) return email;
      return fallback;
    });
  }).catch(function () {
    return fallback;
  }).then(function (email) {
    if (timer) clearTimeout(timer);
    return email;
  });
}

function newAuthLocal() {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var bytes = new Uint8Array(12);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  var local = "r";
  for (var n = 0; n < bytes.length; n++) local += chars[bytes[n] % chars.length];
  return local;
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
          fbDb.collection("users").doc(user.uid).get().then(function (doc) {
            var data = doc.exists ? doc.data() : {};
            setSession(accountName(data, user.email), data.role || "analyst");
            resolve(user);
          }).catch(function () {
            setSession(accountName(null, user.email), "analyst");
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
  // The stored browser role is not trusted. Firestore is the check.
  var user = fbAuth.currentUser;
  if (!user) return Promise.resolve(false);

  return fbDb.collection("users").doc(user.uid).get().then(function (doc) {
    var role = doc.exists && doc.data().role ? doc.data().role : "analyst";
    var admin = role === "admin";
    var session = getSession();
    if (session) {
      session.role = role;
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
    }
    return admin;
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

    lookupAuthEmail(username).then(function (email) {
      return fbAuth.signInWithEmailAndPassword(email, password);
    })
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
        submitBtn.textContent = "Sign in";
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
  var forgotOpen = document.getElementById("forgot-open");
  var forgotFormEl = document.getElementById("forgot-form");
  var resetFormEl = document.getElementById("reset-form");
  if (forgotOpen) forgotOpen.hidden = true;
  if (forgotFormEl) forgotFormEl.hidden = true;
  if (resetFormEl) resetFormEl.hidden = true;

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

// ---- Forgot username or password ----
var forgotBtn = document.getElementById("forgot-btn");
var forgotForm = document.getElementById("forgot-form");
if (forgotBtn && forgotForm && !setupToken && !recoverToken) {
  forgotBtn.addEventListener("click", function () {
    forgotForm.hidden = false;
    var field = document.getElementById("forgot-account");
    if (field) field.focus();
  });

  forgotForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var account = document.getElementById("forgot-account").value.trim();
    var errorEl = document.getElementById("forgot-error");
    var okEl = document.getElementById("forgot-ok");
    var submitBtn = forgotForm.querySelector('button[type="submit"]');
    errorEl.hidden = true;
    okEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: account }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (response.ok) {
          okEl.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = "Email me";
          return;
        }
        var message = "We could not send the email. Try again in a minute.";
        if (body && body.error === "rate") message = "Too many attempts. Wait a few minutes and try again.";
        else if (body && body.error === "invalid") message = "Enter a username or the email on your access request.";
        errorEl.textContent = message;
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Email me";
      });
    }).catch(function () {
      errorEl.textContent = "We could not send the email. Try again in a minute.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Email me";
    });
  });
}

// ---- One-time password reset from the email link. ----
var resetForm = document.getElementById("reset-form");
if (resetForm && recoverToken) {
  var resetLogin = document.getElementById("login-form");
  var resetRequest = document.getElementById("request-access");
  var resetForgotOpen = document.getElementById("forgot-open");
  var resetForgotForm = document.getElementById("forgot-form");
  var resetSetup = document.getElementById("setup-form");
  resetForm.hidden = false;
  if (resetLogin) resetLogin.hidden = true;
  if (resetRequest) resetRequest.hidden = true;
  if (resetForgotOpen) resetForgotOpen.hidden = true;
  if (resetForgotForm) resetForgotForm.hidden = true;
  if (resetSetup) resetSetup.hidden = true;

  var resetError = document.getElementById("reset-error");
  var resetBtn = resetForm.querySelector('button[type="submit"]');
  fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/recover/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: recoverToken }),
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (response.ok) return;
      resetError.textContent = body && body.error === "expired"
        ? "This link has expired. Request a new one from the sign-in page."
        : "This link is invalid or was already used.";
      resetError.hidden = false;
      if (resetBtn) resetBtn.disabled = true;
      recoverToken = "";
      try { sessionStorage.removeItem(RECOVER_KEY); } catch (err) {}
    });
  }).catch(function () {});

  resetForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var password = document.getElementById("reset-password").value;
    var confirmPass = document.getElementById("reset-confirm").value;
    var createdUid = null;
    var finished = false;
    var token = recoverToken;

    function fail(message) {
      resetError.textContent = message;
      resetError.hidden = false;
      resetBtn.disabled = false;
      resetBtn.textContent = "Save password";
      signupInProgress = true;
    }

    resetError.hidden = true;
    if (!token) {
      fail("This link is invalid or was already used.");
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

    resetBtn.disabled = true;
    resetBtn.textContent = "Saving...";
    signupInProgress = true;

    function createLogin(attempt) {
      return fbAuth.createUserWithEmailAndPassword(newAuthLocal() + EMAIL_DOMAIN, password).catch(function (err) {
        if (err && err.code === "auth/email-already-in-use" && attempt < 1) return createLogin(attempt + 1);
        throw err;
      });
    }

    fbAuth.signOut().catch(function () {}).then(function () {
      return createLogin(0);
    }).then(function (cred) {
      createdUid = cred.user.uid;
      return cred.user.getIdToken(true).then(function (idToken) {
        return fetch(TGI_ACCESS_ORIGIN + "/api/goatintel/recover/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: idToken, recoverToken: token }),
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok) {
              var err = new Error("finish");
              err.code = body && body.error ? body.error : "request";
              throw err;
            }
            finished = true;
            var username = body && typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
            if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) username = "member";
            setSession(username, "analyst");
            recoverToken = "";
            try { sessionStorage.removeItem(RECOVER_KEY); } catch (ignore) {}
            return fbDb.collection("users").doc(cred.user.uid).set({
              username: username,
              role: "analyst",
              mustChangePassword: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }).catch(function () {});
          });
        });
      });
    }).then(function () {
      window.location.href = "dashboard.html";
    }).catch(function (err) {
      if (finished) {
        window.location.href = "dashboard.html";
        return;
      }
      var message = "The password could not be saved. Try again.";
      if (err && err.code === "auth/weak-password") message = "Use a password of at least 10 characters.";
      else if (err && err.code === "rate") message = "Too many attempts. Wait a few minutes and try again.";
      else if (err && err.code === "expired") message = "This link has expired. Request a new one from the sign-in page.";
      else if (err && err.code === "invalid") message = "This link is invalid or was already used.";
      else if (err && err.code === "taken") message = "That login is already in use. Request a new link.";
      else if (err && (err.code === "store" || err.code === "unavailable" || err.code === "request")) {
        message = "The password was not saved. Try again.";
      }
      if (err && (err.code === "expired" || err.code === "invalid")) {
        recoverToken = "";
        try { sessionStorage.removeItem(RECOVER_KEY); } catch (ignore) {}
      }
      var cleanup = Promise.resolve();
      if (createdUid && fbAuth.currentUser && fbAuth.currentUser.uid === createdUid) {
        cleanup = fbAuth.currentUser.delete().catch(function () {}).then(function () {
          return fbAuth.signOut();
        });
      }
      cleanup.then(function () { fail(message); });
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
