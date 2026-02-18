/**
 * auth.js — Client-side authentication for Intel Portal
 *
 * SECURITY WARNING: This is client-side authentication for DEMO PURPOSES ONLY.
 * All credential hashes and logic are visible to anyone who inspects the page source.
 * For production use with real sensitive data, implement server-side authentication
 * using solutions such as:
 *   - Firebase Authentication
 *   - Auth0
 *   - A custom backend (Node.js/Express, Python/Flask, etc.) with sessions/JWT
 *   - Netlify Identity or Cloudflare Access for static site protection
 *
 * Default credentials (change the hashes below to set your own):
 *   Username: admin    Password: classified2024
 *   Username: analyst  Password: intel$ecure
 */

const AUTH_KEY = "intel_portal_session";
const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// SHA-256 hashes of "username:password" pairs.
// Generate new hashes with: echo -n "user:pass" | shasum -a 256
const VALID_CREDENTIALS = [
  // SHA-256 hashes (used on HTTPS / localhost)
  "a2ebd311010aa556de3aaca9f99dd04e354cd47e8a1f7621d43f472067892f9d", // admin:classified2024
  "68af29504a3f78f91bed2dadd0c4bf06c7727c4f4511a99a6bcb1c4f9f098d54", // analyst:intel$ecure
  // Fallback hashes (used on file:// URLs where crypto.subtle is unavailable)
  "fallback-454c751e", // admin:classified2024
  "fallback-5863703c", // analyst:intel$ecure
];

async function sha256(message) {
  // crypto.subtle requires a secure context (HTTPS or localhost).
  // On file:// URLs it may be unavailable, so we fall back to a simple hash.
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback: simple string hash (less secure, but works on file:// URLs)
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return "fallback-" + Math.abs(hash).toString(16);
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() - session.timestamp > SESSION_DURATION_MS) {
      sessionStorage.removeItem(AUTH_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function setSession(username) {
  sessionStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ username, timestamp: Date.now() })
  );
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
}

function requireAuth() {
  // Auth disabled during development — auto-create session if missing
  if (!getSession()) {
    setSession("admin");
  }
}

// Login form handler
const loginForm = document.getElementById("login-form");
if (loginForm) {
  // If already authenticated, go to dashboard
  if (getSession()) {
    window.location.href = "dashboard.html";
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const errorMsg = document.getElementById("error-msg");

    const hash = await sha256(username + ":" + password);

    if (VALID_CREDENTIALS.includes(hash)) {
      setSession(username);
      window.location.href = "dashboard.html";
    } else {
      errorMsg.hidden = false;
      document.getElementById("password").value = "";
      document.getElementById("password").focus();
    }
  });
}

// Logout handler
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    clearSession();
    window.location.href = "index.html";
  });
}
