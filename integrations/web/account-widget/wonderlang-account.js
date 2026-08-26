import { initializeApp } from "firebase/app";
import { getToken as getAppCheckToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAuth,
  getRedirectResult,
  EmailAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  linkWithPopup,
  linkWithCredential,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "firebase/auth";
import { friendlyAccountError } from "./auth-errors.js";
import { formatLoginProviders } from "./provider-labels.js";
import "./wonderlang-account.css";

const pageParams = new URLSearchParams(location.search);
const redirectLogin = pageParams.get("redirect_login") === "1";
const previewParam = pageParams.get("demo");
const demoProfile = pageParams.get("profile");
const demoMode = ["localhost", "127.0.0.1", "wl-purchase-entitlement.netlify.app"].includes(location.hostname)
  && previewParam === "1";
const localEmailLinkDemo = ["localhost", "127.0.0.1"].includes(location.hostname)
  && previewParam === "email-link";
const ACCOUNT_DELETION_RECOVERY_DAYS = 30;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

const html = `
  <section class="wl-card">
    <div class="wl-header">
      <div><p class="wl-eyebrow">WONDERLANG ACCOUNT</p><h2>Play anywhere. Keep your progress.</h2></div>
      <button type="button" data-action="sign-out" class="wl-link" hidden>Sign out</button>
    </div>
    <p class="wl-status" role="status" aria-live="polite">Loading account…</p>
    <aside class="wl-demo-banner" data-section="demo-banner" hidden><strong>SIMULATED ACCOUNT DEMO</strong><span>No login, payment, entitlement, cloud save, or account-security action on this page reaches a live service.</span><a href="/account/">Exit demo</a></aside>

    <div class="wl-signed-out" hidden>
      <aside class="wl-device-prompt" data-section="device-prompt" hidden>
        <p class="wl-eyebrow">PC / MAC SIGN-IN</p>
        <h3>Sign in to approve your game.</h3>
        <p>After signing in, confirm that the code on this page exactly matches the code currently shown inside WonderLang.</p>
      </aside>
      <div class="wl-provider-grid">
        <button type="button" data-action="google">Continue with Google</button>
        <button type="button" data-action="apple" class="wl-dark">Continue with Apple</button>
      </div>
      <div class="wl-divider"><span>or use email</span></div>
      <form data-form="email" class="wl-row">
        <label><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
        <button type="submit">Email me a sign-in link</button>
      </form>
    </div>

    <div class="wl-signed-in" hidden>
      <section class="wl-second-platform-request wl-admin-bootstrap" data-section="admin-bootstrap" hidden>
        <div><p class="wl-eyebrow">SECURE INITIAL SETUP</p><h3>Grant this verified owner administrator access</h3></div>
        <p>This one-time operation is available only while the server bootstrap switch is enabled. It accepts only the configured verified Google account, records an audit entry, and signs this browser out after granting access.</p>
        <button type="button" data-action="bootstrap-admin">Grant administrator access</button>
      </section>
      <section class="wl-device-approval" data-section="device-approval" hidden>
        <div><p class="wl-eyebrow">PC / MAC SIGN-IN REQUEST</p><h3>Approve this WonderLang game?</h3></div>
        <div class="wl-device-code"><span>Code shown in the game</span><strong data-field="device-code">—</strong></div>
        <p><strong data-field="device-label">WonderLang PC/Mac</strong> is waiting to use this account. Approve only if this exact code is still visible in your game. The code expires <span data-field="device-expires">shortly</span>.</p>
        <div class="wl-device-actions"><button type="button" data-action="approve-device">Approve this game</button><button type="button" data-action="cancel-device" class="wl-secondary">Cancel</button></div>
      </section>
      <div class="wl-entitlement">
        <p class="wl-eyebrow">YOUR ACCESS</p>
        <strong data-field="access">Checking…</strong>
        <span data-field="cloud"></span>
      </div>
      <div class="wl-account-facts" aria-label="Account summary">
        <div><span>Account email</span><strong data-field="email">—</strong></div>
        <div><span>Login methods</span><strong data-field="providers">—</strong></div>
        <div><span>Subscription</span><strong data-field="subscription">None</strong></div>
        <div><span>Cloud saves</span><strong data-field="cloud-status">—</strong></div>
        <div><span>Mobile platforms</span><strong data-field="mobile-platforms">—</strong></div>
        <div><span>PC / Mac</span><strong data-field="desktop-access">—</strong></div>
        <div><span>Future content</span><strong data-field="future-content">—</strong></div>
        <div><span>Second mobile platform</span><strong data-field="second-platform">—</strong></div>
      </div>
      <section class="wl-second-platform-request" data-section="second-platform-request" hidden>
        <div><p class="wl-eyebrow">PREMIUM INCLUDED BENEFIT</p><h3>Request your other mobile platform</h3></div>
        <p data-field="second-platform-request-status">Premium Lifetime includes one reviewed request for the other mobile platform.</p>
        <div class="wl-second-platform-actions">
          <button type="button" data-action="request-second-platform">Request access</button>
          <button type="button" data-action="cancel-second-platform" class="wl-secondary" hidden>Cancel request</button>
        </div>
      </section>
      <div class="wl-offers">
        <article>
          <p class="wl-eyebrow">FLEXIBLE</p><h3>Mobile Monthly</h3>
          <p><strong data-field="monthly-price">Loading price…</strong> · <span data-field="monthly-trial">3 days free</span> · Full mobile game · Cloud save</p>
          <p class="wl-store-purchase">Available inside WonderLang for Android and iOS through that device's app store.</p>
        </article>
        <article>
          <p class="wl-eyebrow">ONE MOBILE PLATFORM</p><h3>Polyglot Permanent Access</h3>
          <p><strong data-field="polyglot-price">Loading price…</strong> · Full game forever on Android or iOS · No cloud save</p>
          <p class="wl-store-purchase">Available inside WonderLang for Android and iOS through that device's app store.</p>
        </article>
        <article>
          <p class="wl-eyebrow">EVERYTHING, FOREVER</p><h3>Premium Lifetime Pass</h3>
          <p><strong data-field="premium-price">Loading price…</strong> · One permanent mobile platform · One PC/Mac access · Cross-platform cloud save · Future sequels and additional content · A second mobile platform available on request</p>
          <label><span>First mobile platform</span><select data-field="premium-platform"><option value="android">Android</option><option value="ios">iOS</option></select></label>
          <label><span>Included PC/Mac access</span><select data-field="premium-desktop"><option value="steam">Steam key</option><option value="direct">Direct download</option></select></label>
          <label class="wl-confirm" data-field="cancel-confirm" hidden>
            <input type="checkbox"> <span data-field="cancel-confirm-copy">Cancel my current Stripe subscription after the Premium payment succeeds.</span>
          </label>
          <button type="button" data-action="premium">Buy Premium Lifetime</button>
          <button type="button" data-action="discounted-premium" hidden>Use my 50% desktop-customer offer</button>
        </article>
      </div>
      <button type="button" data-action="portal" class="wl-secondary">Manage Stripe subscription</button>
      <div class="wl-provider-grid wl-security-actions">
        <button type="button" data-action="restore" class="wl-secondary">Restore mobile purchases</button>
        <button type="button" data-action="revoke-sessions" class="wl-danger">Sign out all devices</button>
      </div>
      <div class="wl-provider-grid wl-link-providers">
        <button type="button" data-action="link-google" class="wl-secondary">Link Google login</button>
        <button type="button" data-action="link-apple" class="wl-dark">Link Apple login</button>
        <button type="button" data-action="link-email" class="wl-secondary">Link email login</button>
      </div>
      <details>
        <summary>Already bought a Steam or Itch key on wonderlang.net?</summary>
        <p>Link the paid Stripe checkout from your receipt. It does not unlock mobile by itself; it enables one private, single-use Premium Lifetime offer.</p>
        <form data-form="legacy" class="wl-row">
          <label><span>Checkout Session ID</span><input name="checkoutSessionId" placeholder="cs_…" required></label>
          <button type="submit">Verify purchase</button>
        </form>
      </details>
      <details>
        <summary>Account recovery and security</summary>
        <p>You can recover this same account with any linked Google, Apple, or email method. Linking is always explicit; WonderLang never merges unrelated accounts merely because an unverified email matches.</p>
        <button type="button" data-action="delete-account" class="wl-danger">Request account deletion</button>
      </details>
    </div>
  </section>`;

function cookie(name) {
  const match = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function appleProvider() {
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return provider;
}

const demoConfig = {
  accountApiReady: true,
  checkoutEnabled: true,
  adminBootstrapEnabled: false,
  catalog: {
    monthly: { unitAmount: 699, currency: "USD" },
    polyglot: { unitAmount: 3199, currency: "USD" },
    premium: { unitAmount: 5999, currency: "USD" },
    trialDays: 3
  }
};

function createDemoAccount() {
  const premium = demoProfile === "premium";
  return {
    email: "demo-player@example.com",
    linkedLoginProviders: ["google.com", "apple.com"],
    entitlements: {
      accessKind: premium ? "premium_lifetime" : "subscription",
      subscriptionState: premium ? "inactive" : "active",
      cloudSave: true,
      mobilePlatforms: premium ? ["android"] : ["android", "ios"],
      permanentMobilePlatforms: premium ? ["android"] : [],
      pcMacAccess: premium,
      futureContent: premium,
      premiumLifetime: premium,
      secondMobilePlatformEligible: premium,
      chapters: []
    },
    subscription: premium ? null : {
      provider: "stripe",
      phase: "trial",
      trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    stripeBillingAvailable: !premium,
    secondMobilePlatformRequest: null,
    cloudSave: {
      slotCount: 2,
      lastUpdatedAt: new Date().toISOString()
    },
    legacyLifetimeDiscount: { eligible: true }
  };
}

function hasEffectiveSubscription(account) {
  return ["trial", "active", "grace", "cancelled"].includes(account?.subscription?.phase);
}

class WonderLangAccount extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = html;
    this.apiBase = (this.getAttribute("api-base") || location.origin).replace(/\/$/, "");
    this.deviceCode = new URLSearchParams(location.search).get("device_code");
    this.bind();
    if (localEmailLinkDemo) {
      this.querySelector(".wl-signed-out").hidden = false;
      this.status("Local cross-device sign-in preview.");
      const email = await this.confirmEmailForLink();
      this.status(email ? `Confirmed ${email} in the local preview.` : "Email confirmation canceled in the local preview.");
      return;
    }
    if (demoMode) {
      this.querySelector('[data-section="demo-banner"]').hidden = false;
      this.demoAccount = createDemoAccount();
      this.configureCatalog(demoConfig);
      await this.renderUser(null);
      this.status(this.deviceCode
        ? "Safe demo: sign in below to preview the PC/Mac approval flow. No device will be authorized."
        : "Safe account demo. Choose Google, Apple, or email; no real sign-in, purchase, save, or deletion can occur.");
      return;
    }
    try {
      const config = await this.request("/api/v1/config", { authenticated: false });
      this.configureCatalog(config);
      const firebaseApp = initializeApp(config.firebase);
      if (config.appCheck?.recaptchaEnterpriseSiteKey) {
        this.appCheck = initializeAppCheck(firebaseApp, {
          provider: new ReCaptchaEnterpriseProvider(config.appCheck.recaptchaEnterpriseSiteKey),
          isTokenAutoRefreshEnabled: true
        });
      }
      this.auth = getAuth(firebaseApp);
      await this.auth.authStateReady();
      onAuthStateChanged(this.auth, (user) => this.renderUser(user));
      try {
        await this.finishEmailLink();
        await getRedirectResult(this.auth);
      } catch (error) { this.fail(error); }
    } catch (error) { this.fail(error); }
  }

  bind() {
    this.querySelector('[data-action="google"]').addEventListener("click", () => this.provider(new GoogleAuthProvider()));
    this.querySelector('[data-action="apple"]').addEventListener("click", () => this.provider(appleProvider()));
    this.querySelector('[data-action="sign-out"]').addEventListener("click", () => this.signOutCurrent());
    this.querySelector('[data-action="premium"]').addEventListener("click", () => this.checkout(false, this.querySelector('[data-field="premium-platform"]').value, this.querySelector('[data-field="premium-desktop"]').value));
    this.querySelector('[data-action="discounted-premium"]').addEventListener("click", () => this.checkout(true, this.querySelector('[data-field="premium-platform"]').value, this.querySelector('[data-field="premium-desktop"]').value));
    this.querySelector('[data-action="portal"]').addEventListener("click", () => this.openPortal());
    this.querySelector('[data-action="restore"]').addEventListener("click", () => this.restorePurchases());
    this.querySelector('[data-action="revoke-sessions"]').addEventListener("click", () => this.revokeSessions());
    this.querySelector('[data-action="delete-account"]').addEventListener("click", () => this.deleteAccount());
    this.querySelector('[data-action="request-second-platform"]').addEventListener("click", () => this.requestSecondPlatform());
    this.querySelector('[data-action="cancel-second-platform"]').addEventListener("click", () => this.cancelSecondPlatformRequest());
    this.querySelector('[data-action="approve-device"]').addEventListener("click", () => this.approveDevice());
    this.querySelector('[data-action="cancel-device"]').addEventListener("click", () => this.cancelDeviceApproval());
    this.querySelector('[data-action="link-google"]').addEventListener("click", () => this.linkProvider(new GoogleAuthProvider()));
    this.querySelector('[data-action="link-apple"]').addEventListener("click", () => this.linkProvider(appleProvider()));
    this.querySelector('[data-action="link-email"]').addEventListener("click", () => this.linkEmail());
    this.querySelector('[data-action="bootstrap-admin"]').addEventListener("click", () => this.bootstrapAdmin());
    this.querySelector('[data-form="email"]').addEventListener("submit", (event) => this.emailLink(event));
    this.querySelector('[data-form="legacy"]').addEventListener("submit", (event) => this.claimLegacy(event));
  }

  configureCatalog(config) {
    this.config = config;
    const price = (offer, suffix = "") => `${new Intl.NumberFormat(undefined, { style: "currency", currency: offer.currency }).format(offer.unitAmount / 100)}${suffix}`;
    this.querySelector('[data-field="monthly-price"]').textContent = price(config.catalog.monthly, "/month");
    this.querySelector('[data-field="monthly-trial"]').textContent = `${Number(config.catalog.trialDays || 3)} days free`;
    this.querySelector('[data-field="polyglot-price"]').textContent = price(config.catalog.polyglot);
    this.querySelector('[data-field="premium-price"]').textContent = price(config.catalog.premium);
    for (const action of ["premium", "discounted-premium", "portal"]) {
      this.querySelector(`[data-action="${action}"]`).disabled = !config.checkoutEnabled;
    }
    for (const action of ["restore", "revoke-sessions", "delete-account", "request-second-platform", "cancel-second-platform", "approve-device"]) {
      this.querySelector(`[data-action="${action}"]`).disabled = !config.accountApiReady;
    }
    this.querySelector('[data-form="legacy"] button').disabled = !config.accountApiReady;
  }

  async signOutCurrent() {
    if (demoMode) {
      await this.renderUser(null);
      this.status("Signed out of the safe account demo.");
      return;
    }
    await signOut(this.auth);
  }

  async provider(provider) {
    if (demoMode) {
      const providerId = provider.providerId || "demo";
      if (!this.demoAccount.linkedLoginProviders.includes(providerId)) this.demoAccount.linkedLoginProviders.push(providerId);
      await this.renderUser({ email: this.demoAccount.email, providerId });
      if (!this.deviceCode) {
        this.status(`Signed in with ${providerId === "apple.com" ? "Apple" : "Google"} in the safe demo.`);
      }
      return;
    }
    if (redirectLogin) {
      this.status("Continuing securely in this browser…");
      try { await signInWithRedirect(this.auth, provider); }
      catch (redirectError) { this.fail(redirectError); }
      return;
    }
    this.status("Opening secure sign-in…");
    try {
      await signInWithPopup(this.auth, provider);
    } catch (error) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/internal-error"].includes(error?.code)) {
        this.status("The sign-in popup is unavailable. Continuing securely in this browser…");
        try { await signInWithRedirect(this.auth, provider); }
        catch (redirectError) { this.fail(redirectError); }
        return;
      }
      this.fail(error);
    }
  }

  async linkProvider(provider) {
    if (demoMode) {
      if (!this.user) return this.status("Sign in first.");
      const providerId = provider.providerId || "demo";
      if (!this.demoAccount.linkedLoginProviders.includes(providerId)) this.demoAccount.linkedLoginProviders.push(providerId);
      await this.renderUser(this.user);
      this.status(`${providerId === "apple.com" ? "Apple" : "Google"} login linked in the safe demo.`);
      return;
    }
    if (!this.auth?.currentUser) return this.status("Sign in first.");
    this.status("Linking sign-in method…");
    try {
      await linkWithPopup(this.auth.currentUser, provider);
      this.status("Sign-in method linked to this WonderLang account.");
    } catch (error) { this.fail(error); }
  }

  async emailLink(event) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email").trim().toLowerCase();
    if (demoMode) {
      this.demoAccount.email = email;
      await this.renderUser({ email, providerId: "passwordless-email" });
      this.status(`Secure email-link sign-in simulated for ${email}.`);
      return;
    }
    await this.sendEmailLink(email, false);
  }

  async linkEmail() {
    if (demoMode) {
      if (!this.user) return this.status("Sign in first.");
      if (!this.demoAccount.linkedLoginProviders.includes("password")) this.demoAccount.linkedLoginProviders.push("password");
      await this.renderUser(this.user);
      this.status("Passwordless email login linked in the safe demo.");
      return;
    }
    if (!this.auth?.currentUser) return this.status("Sign in first.");
    const email = await this.confirmEmailForLink({
      title: "Link passwordless email",
      copy: "Enter the email address you want to use to recover this same WonderLang account. Open the link in this browser while you remain signed in.",
      submitLabel: "Send link"
    });
    if (!email) return;
    await this.sendEmailLink(email, true);
  }

  async sendEmailLink(email, linkToCurrentUser) {
    try {
      const continueUrl = new URL(location.href);
      continueUrl.searchParams.delete("mode");
      continueUrl.searchParams.delete("oobCode");
      continueUrl.searchParams.delete("apiKey");
      continueUrl.searchParams.set("link_email", linkToCurrentUser ? "1" : "0");
      await sendSignInLinkToEmail(this.auth, email, { url: continueUrl.toString(), handleCodeInApp: true });
      localStorage.setItem("wl-email-link", email);
      if (linkToCurrentUser) {
        localStorage.setItem("wl-email-link-purpose", "link");
        localStorage.setItem("wl-email-link-uid", this.auth.currentUser.uid);
      } else {
        localStorage.removeItem("wl-email-link-purpose");
        localStorage.removeItem("wl-email-link-uid");
      }
      this.status(linkToCurrentUser
        ? "Check your email, then open the link in this browser to finish linking."
        : "Check your email for the secure sign-in link.");
    } catch (error) { this.fail(error); }
  }

  async finishEmailLink() {
    if (!isSignInWithEmailLink(this.auth, location.href)) return;
    const email = localStorage.getItem("wl-email-link") || await this.confirmEmailForLink();
    if (!email) throw new Error("Email confirmation is required to finish sign-in.");
    const linkRequested = new URL(location.href).searchParams.get("link_email") === "1"
      && localStorage.getItem("wl-email-link-purpose") === "link";
    if (linkRequested) {
      const current = this.auth.currentUser;
      const intendedUid = localStorage.getItem("wl-email-link-uid");
      if (!current || !intendedUid || current.uid !== intendedUid) {
        throw new Error("For security, sign in to the original WonderLang account in this browser before linking this email.");
      }
      const credential = EmailAuthProvider.credentialWithLink(email, location.href);
      await linkWithCredential(current, credential);
      this.status("Passwordless email login linked to this WonderLang account.");
    } else {
      await signInWithEmailLink(this.auth, email, location.href);
    }
    localStorage.removeItem("wl-email-link");
    localStorage.removeItem("wl-email-link-purpose");
    localStorage.removeItem("wl-email-link-uid");
    history.replaceState({}, document.title, location.pathname);
  }

  confirmEmailForLink(options = {}) {
    return new Promise((resolve) => {
      const holder = document.createElement("div");
      const titleId = `wl-email-dialog-${crypto.randomUUID()}`;
      holder.className = "wl-modal-backdrop";
      holder.innerHTML = `<section class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <p class="wl-eyebrow">SECURE SIGN-IN</p>
        <h3 id="${titleId}">${escapeHtml(options.title || "Confirm your email")}</h3>
        <p>${escapeHtml(options.copy || "This sign-in link was opened on a different browser or device. Enter the same email address that received the link.")}</p>
        <form class="wl-modal-form">
          <label><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
          <div><button type="button" class="wl-secondary" data-close>Cancel</button><button type="submit">${escapeHtml(options.submitLabel || "Continue")}</button></div>
        </form>
      </section>`;
      let settled = false;
      const close = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeydown);
        holder.remove();
        resolve(value);
      };
      const onKeydown = (event) => { if (event.key === "Escape") close(null); };
      holder.querySelector("[data-close]").addEventListener("click", () => close(null));
      holder.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        close(String(new FormData(event.currentTarget).get("email")).trim().toLowerCase());
      });
      document.addEventListener("keydown", onKeydown);
      this.append(holder);
      holder.querySelector("input").focus();
    });
  }

  async renderUser(user) {
    this.user = user;
    this.querySelector(".wl-signed-out").hidden = Boolean(user);
    this.querySelector(".wl-signed-in").hidden = !user;
    this.querySelector('[data-action="sign-out"]').hidden = !user;
    this.querySelector('[data-section="admin-bootstrap"]').hidden = !user
      || !this.config.adminBootstrapEnabled
      || pageParams.get("bootstrap_admin") !== "1";
    this.querySelector('[data-section="device-prompt"]').hidden = Boolean(user) || !this.deviceCode;
    this.querySelector('[data-section="device-approval"]').hidden = true;
    if (!user) {
      this.status(this.deviceCode
        ? "Sign in to review the PC/Mac request. No device is approved until you confirm it."
        : "Sign in to sync purchases and cloud saves across platforms.");
      return;
    }
    this.status(`Signed in as ${user.email || "your WonderLang account"}`);
    if (!this.config.accountApiReady) {
      const providers = (user.providerData || []).map((provider) => provider.providerId).filter(Boolean);
      this.account = null;
      this.querySelector('[data-field="access"]').textContent = "Server account setup pending";
      this.querySelector('[data-field="cloud"]').textContent = "Cloud save is unavailable until the test backend is configured";
      this.querySelector('[data-field="email"]').textContent = user.email || "No email available";
      this.querySelector('[data-field="providers"]').textContent = formatLoginProviders(providers);
      this.querySelector('[data-field="subscription"]').textContent = "Unavailable during server setup";
      this.querySelector('[data-field="cloud-status"]').textContent = "Unavailable during server setup";
      this.querySelector('[data-field="mobile-platforms"]').textContent = "Unavailable during server setup";
      this.querySelector('[data-field="desktop-access"]').textContent = "Unavailable during server setup";
      this.querySelector('[data-field="future-content"]').textContent = "Unavailable during server setup";
      this.querySelector('[data-field="second-platform"]').textContent = "Unavailable during server setup";
      this.status(`Signed in with Firebase as ${user.email || "your WonderLang account"}. Account data and entitlements will become available after the test backend is configured.`);
      return;
    }
    try {
      this.account = await this.request("/api/v1/me");
      const ent = this.account.entitlements;
      const access = ent.accessKind === "premium_lifetime" ? "Premium Lifetime Pass"
        : ent.accessKind === "permanent" ? "Polyglot Permanent Access"
        : ent.accessKind === "subscription" ? `Monthly full access${ent.subscriptionState === "grace" ? " · payment grace" : ""}`
        : ent.accessKind === "legacy" ? `Legacy mobile access${ent.chapters.length ? ` · chapter ${ent.chapters.join(", ")}` : ""}`
        : "Free access";
      this.querySelector('[data-field="access"]').textContent = access;
      this.querySelector('[data-field="cloud"]').textContent = ent.cloudSave ? "Cloud save enabled" : "Cloud save requires Mobile Monthly or Premium Lifetime";
      this.querySelector('[data-field="email"]').textContent = this.account.email || "No email available";
      this.querySelector('[data-field="providers"]').textContent = formatLoginProviders(this.account.linkedLoginProviders);
      const sub = this.account.subscription;
      const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : null;
      this.querySelector('[data-field="subscription"]').textContent = !sub ? "None" : `${sub.phase}${sub.trialEndsAt ? ` · trial ends ${date(sub.trialEndsAt)}` : sub.graceEndsAt ? ` · grace ends ${date(sub.graceEndsAt)}` : sub.renewsAt ? ` · renews ${date(sub.renewsAt)}` : sub.endsAt ? ` · ends ${date(sub.endsAt)}` : ""}`;
      const cloud = this.account.cloudSave;
      this.querySelector('[data-field="cloud-status"]').textContent = `${cloud.slotCount} saved slot${cloud.slotCount === 1 ? "" : "s"}${cloud.lastUpdatedAt ? ` · last sync ${date(cloud.lastUpdatedAt)}` : ""}`;
      const permanentPlatforms = ent.permanentMobilePlatforms || [];
      this.querySelector('[data-field="mobile-platforms"]').textContent = (ent.mobilePlatforms || []).map((platform) => {
        const label = platform === "ios" ? "iOS" : "Android";
        if (permanentPlatforms.includes(platform)) return `${label} · permanent`;
        return ent.accessKind === "subscription" ? `${label} · subscription` : label;
      }).join(" / ") || "None";
      this.querySelector('[data-field="desktop-access"]').textContent = ent.pcMacAccess ? "Included" : "Not included";
      this.querySelector('[data-field="future-content"]').textContent = ent.futureContent ? "Included" : "Not included";
      this.querySelector('[data-field="second-platform"]').textContent = ent.secondMobilePlatformEligible
        ? permanentPlatforms.length > 1 ? "Granted" : "Eligible on request"
        : "Not included";
      const requestSection = this.querySelector('[data-section="second-platform-request"]');
      const requestStatus = this.querySelector('[data-field="second-platform-request-status"]');
      const requestButton = this.querySelector('[data-action="request-second-platform"]');
      const cancelRequestButton = this.querySelector('[data-action="cancel-second-platform"]');
      const secondPlatformRequest = this.account.secondMobilePlatformRequest;
      const targetPlatform = permanentPlatforms[0] === "android" ? "iOS" : permanentPlatforms[0] === "ios" ? "Android" : "the other mobile platform";
      requestSection.hidden = !ent.secondMobilePlatformEligible;
      if (ent.secondMobilePlatformEligible) {
        requestButton.textContent = `Request ${targetPlatform} access`;
        if (permanentPlatforms.length > 1) {
          requestStatus.textContent = "Android and iOS permanent access are both granted on this WonderLang account.";
          requestButton.hidden = true;
          cancelRequestButton.hidden = true;
        } else if (secondPlatformRequest?.state === "pending") {
          requestStatus.textContent = `${targetPlatform} access was requested and is waiting for WonderLang support review. No purchase is required.`;
          requestButton.hidden = true;
          cancelRequestButton.hidden = false;
        } else if (secondPlatformRequest?.state === "approving") {
          requestStatus.textContent = `${targetPlatform} access is currently being approved. Refresh this page shortly.`;
          requestButton.hidden = true;
          cancelRequestButton.hidden = true;
        } else if (secondPlatformRequest?.state === "approved") {
          requestStatus.textContent = `${targetPlatform} access was approved. Refresh your purchases if it is not visible yet.`;
          requestButton.hidden = true;
          cancelRequestButton.hidden = true;
        } else if (secondPlatformRequest?.state === "declined") {
          requestStatus.textContent = `${targetPlatform} access was not approved. You may submit a fresh request or contact WonderLang support.`;
          requestButton.hidden = false;
          cancelRequestButton.hidden = true;
        } else {
          requestStatus.textContent = `Premium Lifetime includes ${targetPlatform} permanent access on request. WonderLang support reviews the request; no purchase is required.`;
          requestButton.hidden = false;
          cancelRequestButton.hidden = true;
        }
      }
      const subscribed = hasEffectiveSubscription(this.account);
      const billingButton = this.querySelector('[data-action="portal"]');
      billingButton.textContent = sub?.provider === "google_play" ? "Manage Google Play subscription"
        : sub?.provider === "apple" ? "Manage Apple subscription"
          : sub?.provider === "stripe" ? "Manage Stripe subscription" : "Manage Stripe billing";
      this.querySelector('[data-field="cancel-confirm-copy"]').textContent = sub?.provider === "google_play"
        ? "I understand that I must cancel my Google Play subscription separately after the Premium payment succeeds."
        : sub?.provider === "apple"
          ? "I understand that I must cancel my Apple subscription separately after the Premium payment succeeds."
          : "Cancel my current Stripe subscription after the Premium payment succeeds.";
      this.querySelector('[data-field="cancel-confirm"]').hidden = !subscribed;
      this.querySelector('[data-action="premium"]').disabled = !this.config.checkoutEnabled || ent.premiumLifetime;
      this.querySelector('[data-action="discounted-premium"]').hidden = !this.account.legacyLifetimeDiscount.eligible || ent.premiumLifetime;
      this.querySelector('[data-action="discounted-premium"]').disabled = !this.config.checkoutEnabled || ent.premiumLifetime;
      billingButton.disabled = sub?.provider === "google_play" || sub?.provider === "apple"
        ? false
        : !this.config.checkoutEnabled || !this.account.stripeBillingAvailable;
      await this.loadDeviceApproval();
    } catch (error) { this.fail(error); }
  }

  async loadDeviceApproval() {
    if (!this.deviceCode || !this.user) return;
    const section = this.querySelector('[data-section="device-approval"]');
    try {
      const request = await this.request(`/api/v1/device-sign-in/preview?code=${encodeURIComponent(this.deviceCode)}`);
      this.deviceCode = request.userCode;
      this.querySelector('[data-field="device-code"]').textContent = request.userCode;
      this.querySelector('[data-field="device-label"]').textContent = request.deviceLabel;
      this.querySelector('[data-field="device-expires"]').textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.expiresAt));
      section.hidden = false;
      this.status(request.state === "approved"
        ? "This game is already approved and is finishing sign-in."
        : "Review the PC/Mac sign-in request below.");
      this.querySelector('[data-action="approve-device"]').disabled = request.state === "approved";
    } catch (error) { this.fail(error); }
  }

  async approveDevice() {
    if (!this.deviceCode || !this.user) return;
    const button = this.querySelector('[data-action="approve-device"]');
    button.disabled = true;
    try {
      const result = await this.request("/api/v1/device-sign-in/approve", { method: "POST", body: { userCode: this.deviceCode } });
      this.querySelector('[data-field="device-code"]').textContent = result.userCode;
      this.querySelector('[data-section="device-approval"]').classList.add("approved");
      this.querySelector('[data-action="cancel-device"]').hidden = true;
      this.clearDeviceCodeFromUrl();
      this.status(`Approved ${result.deviceLabel}. Return to WonderLang; it will finish signing in automatically.`);
    } catch (error) {
      button.disabled = false;
      this.fail(error);
    }
  }

  cancelDeviceApproval() {
    this.clearDeviceCodeFromUrl();
    this.querySelector('[data-section="device-prompt"]').hidden = true;
    this.querySelector('[data-section="device-approval"]').hidden = true;
    this.status("PC/Mac sign-in was not approved. You can close this page.");
  }

  clearDeviceCodeFromUrl() {
    this.deviceCode = null;
    const next = new URL(location.href);
    next.searchParams.delete("device_code");
    history.replaceState({}, document.title, `${next.pathname}${next.search}${next.hash}`);
  }

  async checkout(useDiscount, mobilePlatform, desktopDelivery) {
    const subscribed = hasEffectiveSubscription(this.account);
    const confirmation = this.querySelector('[data-field="cancel-confirm"] input');
    if (subscribed && !confirmation.checked) {
      this.status("Confirm subscription cancellation before starting the Premium Lifetime checkout.");
      confirmation.focus();
      return;
    }
    if (demoMode) {
      const offer = useDiscount ? "discounted Premium Lifetime purchase" : "Premium Lifetime purchase";
      this.status(`Safe demo: ${offer} checkout validated. No payment page was opened.`);
      return;
    }
    try {
      const result = await this.request("/api/v1/checkout", {
        method: "POST",
        body: {
          product: "premium_lifetime_pass",
          ...(mobilePlatform ? { mobilePlatform } : {}),
          ...(desktopDelivery ? { desktopDelivery } : {}),
          useLegacyDesktopDiscount: useDiscount,
          confirmCancelExistingSubscription: Boolean(subscribed && confirmation.checked),
          attribution: {
            fbp: cookie("_fbp"), fbc: cookie("_fbc"), ttp: cookie("_ttp"),
            ttclid: new URLSearchParams(location.search).get("ttclid") || undefined
          }
        }
      });
      location.assign(result.url);
    } catch (error) { this.fail(error); }
  }

  async openPortal() {
    if (demoMode) {
      this.status("Safe demo: the Stripe customer portal would open here.");
      return;
    }
    const provider = this.account?.subscription?.provider;
    if (provider === "google_play") {
      location.assign("https://play.google.com/store/account/subscriptions");
      return;
    }
    if (provider === "apple") {
      location.assign("https://apps.apple.com/account/subscriptions");
      return;
    }
    try { location.assign((await this.request("/api/v1/billing-portal", { method: "POST", body: {} })).url); }
    catch (error) { this.fail(error); }
  }

  async requestSecondPlatform() {
    try {
      const result = await this.request("/api/v1/me/second-platform-request", { method: "POST", body: {} });
      this.account.secondMobilePlatformRequest = result;
      await this.renderUser(this.user);
      this.status(`Your ${result.requestedPlatform === "ios" ? "iOS" : "Android"} access request was submitted for review. No purchase is required.`);
    } catch (error) { this.fail(error); }
  }

  async cancelSecondPlatformRequest() {
    try {
      const result = await this.request("/api/v1/me/second-platform-request/cancel", { method: "POST", body: {} });
      this.account.secondMobilePlatformRequest = result;
      await this.renderUser(this.user);
      this.status("The second-platform request was canceled. Your existing access is unchanged.");
    } catch (error) { this.fail(error); }
  }

  async restorePurchases() {
    if (demoMode) {
      this.status("Safe demo: mobile purchase restoration requested. No store was contacted.");
      return;
    }
    const native = window.AndroidManager;
    if (!native?.refreshPurchases) {
      this.status("Open WonderLang on Android or iOS to restore that store's purchases; website purchases are already synchronized after sign-in.");
      return;
    }
    try {
      if (native.refreshPurchases() === false) throw new Error("The mobile store is not ready yet.");
      this.status("Checking mobile purchases. Access will refresh after server verification.");
    } catch (error) { this.fail(error); }
  }

  async revokeSessions() {
    const phrase = await this.confirmPhrase(
      "Sign out every device?",
      "This revokes every WonderLang login session, including this browser. Your purchases and cloud saves are not deleted.",
      "SIGN OUT ALL DEVICES"
    );
    if (!phrase) return;
    try {
      await this.request("/api/v1/me/revoke-sessions", { method: "POST", body: { confirmationPhrase: phrase } });
      if (demoMode) await this.renderUser(null); else await signOut(this.auth);
      this.status("All WonderLang sessions were revoked. Sign in again on devices you still use.");
    } catch (error) { this.fail(error); }
  }

  async bootstrapAdmin() {
    if (!this.user?.email) return;
    const confirmation = `SET ADMIN ${this.user.email.trim().toLowerCase()}`;
    const phrase = await this.confirmPhrase(
      "Grant initial administrator access?",
      "This grants access to customer, entitlement, refund, import, key, save, and audit operations. The action is audited and this browser will be signed out immediately.",
      confirmation
    );
    if (!phrase) return;
    try {
      const result = await this.request("/api/v1/admin-bootstrap", { method: "POST", body: { confirmationPhrase: phrase } });
      if (!result.granted) throw new Error("Administrator access was not granted.");
      await signOut(this.auth);
      location.assign("/admin/?bootstrap=success");
    } catch (error) { this.fail(error); }
  }

  async deleteAccount() {
    try {
      const preview = await this.request("/api/v1/me/deletion-preview", { method: "POST", body: {} });
      const phrase = await this.confirmPhrase(
        "Schedule account deletion?",
        `${(preview.consequences || []).join(" ")} You have ${preview.recoveryDays} days to ask support to cancel.`,
        preview.confirmationPhrase
      );
      if (!phrase) return;
      const result = await this.request("/api/v1/me/deletion-commit", { method: "POST", body: { previewId: preview.previewId, confirmationPhrase: phrase } });
      if (demoMode) await this.renderUser(null); else await signOut(this.auth);
      this.status(`Account deletion is scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(result.deleteAfter))}. Contact support before then to recover it.`);
    } catch (error) { this.fail(error); }
  }

  confirmPhrase(title, copy, phrase) {
    return new Promise((resolve) => {
      const holder = document.createElement("div");
      const titleId = `wl-confirm-dialog-${crypto.randomUUID()}`;
      holder.className = "wl-modal-backdrop";
      holder.innerHTML = `<section class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><p class="wl-eyebrow">ACCOUNT SECURITY</p><h3 id="${titleId}">${title}</h3><p>${copy}</p><form class="wl-modal-form"><label><span>Type ${phrase}</span><input name="phrase" autocomplete="off" required></label><div><button type="button" class="wl-secondary" data-close>Cancel</button><button type="submit" class="wl-danger">Confirm</button></div></form></section>`;
      let settled = false;
      const close = (value) => { if (settled) return; settled = true; document.removeEventListener("keydown", onKeydown); holder.remove(); resolve(value); };
      const onKeydown = (event) => { if (event.key === "Escape") close(null); };
      const phraseInput = holder.querySelector('input[name="phrase"]');
      phraseInput.addEventListener("input", () => phraseInput.setCustomValidity(""));
      holder.querySelector("[data-close]").addEventListener("click", () => close(null));
      holder.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("phrase") || "").trim(); if (value === phrase) close(value); else { phraseInput.setCustomValidity("The confirmation phrase does not match."); phraseInput.reportValidity(); } });
      document.addEventListener("keydown", onKeydown);
      this.append(holder);
      phraseInput.focus();
    });
  }

  async claimLegacy(event) {
    event.preventDefault();
    const checkoutSessionId = new FormData(event.currentTarget).get("checkoutSessionId").trim();
    try {
      await this.request("/api/v1/legacy/claim", { method: "POST", body: { checkoutSessionId } });
      await this.renderUser(this.user);
      this.status("Desktop purchase verified. Your private 50% Premium Lifetime offer is ready.");
    } catch (error) { this.fail(error); }
  }

  async request(path, options = {}) {
    if (demoMode) return this.demoRequest(path, options);
    const authenticated = options.authenticated !== false;
    const user = authenticated ? this.auth?.currentUser : null;
    if (authenticated && !user) throw new Error("Sign in first.");

    const send = async (forceRefresh = false) => {
      const headers = { "content-type": "application/json" };
      if (user) headers.authorization = `Bearer ${await user.getIdToken(forceRefresh)}`;
      if (this.appCheck) {
        try {
          const appCheckToken = await getAppCheckToken(this.appCheck, forceRefresh);
          if (appCheckToken.token) headers["x-firebase-appcheck"] = appCheckToken.token;
        } catch {
          // App Check remains fail-open until every shipping client has been registered and tested.
        }
      }
      const response = await fetch(`${this.apiBase}${path}`, {
        method: options.method || "GET", headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
      return { response, result: await response.json().catch(() => ({})) };
    };

    let attempt = await send();
    if (authenticated && attempt.response.status === 401) attempt = await send(true);
    if (!attempt.response.ok) throw new Error(attempt.result.error || `Request failed (${attempt.response.status}).`);
    return attempt.result;
  }

  demoRequest(path) {
    if (path === "/api/v1/config") return demoConfig;
    if (path === "/api/v1/me/deletion-preview") {
      return {
        previewId: "demo-deletion-preview",
        confirmationPhrase: "DELETE WONDERLANG ACCOUNT",
        recoveryDays: ACCOUNT_DELETION_RECOVERY_DAYS,
        consequences: ["Login sessions will be revoked.", "Cloud saves will be queued for deletion.", "Purchase records remain for accounting and restore fraud prevention."]
      };
    }
    if (path === "/api/v1/me/deletion-commit") {
      return { deleteAfter: new Date(Date.now() + ACCOUNT_DELETION_RECOVERY_DAYS * 24 * 60 * 60 * 1000).toISOString() };
    }
    if (path === "/api/v1/me/revoke-sessions") return { revoked: true };
    if (path === "/api/v1/admin-bootstrap") return { granted: true, changed: true, signInAgain: true };
    if (path === "/api/v1/me/second-platform-request/cancel") {
      if (!this.demoAccount.secondMobilePlatformRequest || this.demoAccount.secondMobilePlatformRequest.state !== "pending") throw new Error("Only a pending second-platform request can be canceled.");
      this.demoAccount.secondMobilePlatformRequest = {
        ...this.demoAccount.secondMobilePlatformRequest,
        state: "canceled",
        updatedAt: new Date().toISOString(),
        decisionAt: new Date().toISOString()
      };
      return this.demoAccount.secondMobilePlatformRequest;
    }
    if (path === "/api/v1/me/second-platform-request") {
      if (!this.demoAccount.entitlements.premiumLifetime) throw new Error("Premium Lifetime is required to request the other mobile platform.");
      const sourcePlatform = this.demoAccount.entitlements.permanentMobilePlatforms[0];
      if (!sourcePlatform) throw new Error("The primary Premium mobile platform must be resolved first.");
      const now = new Date().toISOString();
      this.demoAccount.secondMobilePlatformRequest = {
        state: "pending",
        sourcePlatform,
        requestedPlatform: sourcePlatform === "android" ? "ios" : "android",
        revision: (this.demoAccount.secondMobilePlatformRequest?.revision || 0) + 1,
        submittedAt: now,
        updatedAt: now,
        approvalLeaseUntil: null,
        decisionAt: null
      };
      return this.demoAccount.secondMobilePlatformRequest;
    }
    if (path.startsWith("/api/v1/device-sign-in/preview")) {
      const raw = this.deviceCode || "W7ND-L4NG";
      const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8).padEnd(8, "7");
      return { userCode: `${normalized.slice(0, 4)}-${normalized.slice(4)}`, deviceLabel: "Jonathan's PC", expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(), state: "pending" };
    }
    if (path === "/api/v1/device-sign-in/approve") {
      return { approved: true, userCode: this.deviceCode || "W7ND-L4NG", deviceLabel: "Jonathan's PC" };
    }
    if (path === "/api/v1/legacy/claim") {
      this.demoAccount.legacyLifetimeDiscount.eligible = true;
      return { eligible: true };
    }
    if (path === "/api/v1/me") return this.demoAccount;
    throw new Error(`The safe demo does not implement ${path}.`);
  }

  status(message) { this.querySelector(".wl-status").textContent = message; }
  fail(error) { console.error(error); this.status(friendlyAccountError(error)); }
}

customElements.define("wonderlang-account", WonderLangAccount);
