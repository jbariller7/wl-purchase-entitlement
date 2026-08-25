const messages = new Map([
  ["auth/network-request-failed", "Sign-in could not reach Firebase. Check your connection, or open this page in Safari, Chrome, Edge, or Firefox and try again."],
  ["auth/operation-not-allowed", "This sign-in method is not configured yet. Please use another method or contact WonderLang support."],
  ["auth/unauthorized-domain", "This WonderLang sign-in page is not authorized yet. Please contact WonderLang support."],
  ["auth/popup-closed-by-user", "Sign-in was canceled before it finished."],
  ["auth/cancelled-popup-request", "The previous sign-in window was replaced. Please try once more."],
  ["auth/user-disabled", "This WonderLang account is disabled. Please contact WonderLang support."],
  ["auth/invalid-action-code", "This email sign-in link is invalid or has already been used. Request a new link and try again."],
  ["auth/expired-action-code", "This email sign-in link has expired. Request a new link and try again."],
  ["auth/too-many-requests", "Too many sign-in attempts were made. Wait a few minutes, then try again."],
  ["auth/provider-already-linked", "This login method is already linked to your WonderLang account."],
  ["auth/credential-already-in-use", "This login method is already linked to another WonderLang account. Sign out and recover that account; WonderLang never merges accounts automatically."],
  ["auth/email-already-in-use", "This email login is already linked to another WonderLang account. Sign out and recover that account; WonderLang never merges accounts automatically."],
  ["auth/account-exists-with-different-credential", "A different login method already uses this email. Sign in with that method, then explicitly link this one from Account recovery and security."],
  ["auth/web-storage-unsupported", "This browser blocks the secure storage required for sign-in. Enable site storage or open the page in Safari, Chrome, Edge, or Firefox."],
  ["auth/operation-not-supported-in-this-environment", "This browser cannot complete the sign-in flow. Open the page in Safari, Chrome, Edge, or Firefox and try again."],
  ["auth/internal-error", "Sign-in could not start in this browser. Open the page in Safari, Chrome, Edge, or Firefox and try again."]
]);

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function friendlyAccountError(error) {
  const code = clean(error && typeof error === "object" ? error.code : "");
  const known = messages.get(code);
  if (known) return known;
  const raw = clean(error && typeof error === "object" ? error.message : error);
  if (!raw || /^Firebase:\s*Error\b/i.test(raw)) return "Something went wrong. Please try again or contact WonderLang support.";
  return raw;
}
