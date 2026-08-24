import { initializeApp } from "firebase/app";
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
import "./wonderlang-account.css";

const previewParam = new URLSearchParams(location.search).get("demo");
const demoMode = ["localhost", "127.0.0.1", "wl-purchase-entitlement.netlify.app"].includes(location.hostname)
  && previewParam === "1";
const localEmailLinkDemo = ["localhost", "127.0.0.1"].includes(location.hostname)
  && previewParam === "email-link";

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

    <div class="wl-signed-out" hidden>
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
      </div>
      <div class="wl-offers">
        <article>
          <p class="wl-eyebrow">FLEXIBLE</p><h3>Mobile Monthly</h3>
          <p><strong data-field="monthly-price">Loading price…</strong> · <span data-field="monthly-trial">3 days free</span> · Full mobile game · Cloud save</p>
          <button type="button" data-action="monthly">Start monthly</button>
        </article>
        <article>
          <p class="wl-eyebrow">ONE MOBILE PLATFORM</p><h3>Polyglot Permanent Access</h3>
          <p><strong data-field="polyglot-price">Loading price…</strong> · Full game forever on Android or iOS · No cloud save</p>
          <label><span>Mobile platform</span><select data-field="polyglot-platform"><option value="android">Android</option><option value="ios">iOS</option></select></label>
          <button type="button" data-action="polyglot">Buy permanent access</button>
        </article>
        <article>
          <p class="wl-eyebrow">EVERYTHING, FOREVER</p><h3>Premium Lifetime Pass</h3>
          <p><strong data-field="premium-price">Loading price…</strong> · One permanent mobile platform · One PC/Mac access · Cross-platform cloud save · Future sequels and additional content · A second mobile platform available on request</p>
          <label><span>First mobile platform</span><select data-field="premium-platform"><option value="android">Android</option><option value="ios">iOS</option></select></label>
          <label><span>Included PC/Mac access</span><select data-field="premium-desktop"><option value="steam">Steam key</option><option value="direct">Direct download</option></select></label>
          <label class="wl-confirm" data-field="cancel-confirm" hidden>
            <input type="checkbox"> Cancel my current Stripe subscription after the Premium payment succeeds.
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
  checkoutEnabled: true,
  catalog: {
    monthly: { unitAmount: 699, currency: "USD" },
    polyglot: { unitAmount: 3199, currency: "USD" },
    premium: { unitAmount: 5999, currency: "USD" },
    trialDays: 3
  }
};

function createDemoAccount() {
  return {
    email: "demo-player@example.com",
    linkedLoginProviders: ["google.com", "apple.com"],
    entitlements: {
      accessKind: "subscription",
      subscriptionState: "active",
      cloudSave: true,
      mobilePlatforms: ["android", "ios"],
      pcMacAccess: false,
      futureContent: false,
      premiumLifetime: false,
      secondMobilePlatformEligible: false,
      chapters: []
    },
    subscription: {
      phase: "trialing",
      trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    cloudSave: {
      slotCount: 2,
      lastUpdatedAt: new Date().toISOString()
    },
    legacyLifetimeDiscount: { eligible: true }
  };
}

class WonderLangAccount extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = html;
    this.apiBase = (this.getAttribute("api-base") || location.origin).replace(/\/$/, "");
    this.bind();
    if (localEmailLinkDemo) {
      this.querySelector(".wl-signed-out").hidden = false;
      this.status("Local cross-device sign-in preview.");
      const email = await this.confirmEmailForLink();
      this.status(email ? `Confirmed ${email} in the local preview.` : "Email confirmation canceled in the local preview.");
      return;
    }
    if (demoMode) {
      this.demoAccount = createDemoAccount();
      this.configureCatalog(demoConfig);
      await this.renderUser(null);
      this.status("Safe account demo. Choose Google, Apple, or email; no real sign-in, purchase, save, or deletion can occur.");
      return;
    }
    try {
      const config = await this.request("/api/v1/config", { authenticated: false });
      this.configureCatalog(config);
      this.auth = getAuth(initializeApp(config.firebase));
      await this.auth.authStateReady();
      await this.finishEmailLink();
      await getRedirectResult(this.auth).catch((error) => { throw error; });
      onAuthStateChanged(this.auth, (user) => this.renderUser(user));
    } catch (error) { this.fail(error); }
  }

  bind() {
    this.querySelector('[data-action="google"]').addEventListener("click", () => this.provider(new GoogleAuthProvider()));
    this.querySelector('[data-action="apple"]').addEventListener("click", () => this.provider(appleProvider()));
    this.querySelector('[data-action="sign-out"]').addEventListener("click", () => this.signOutCurrent());
    this.querySelector('[data-action="monthly"]').addEventListener("click", () => this.checkout("mobile_full_monthly", false));
    this.querySelector('[data-action="polyglot"]').addEventListener("click", () => this.checkout("mobile_polyglot_permanent", false, this.querySelector('[data-field="polyglot-platform"]').value));
    this.querySelector('[data-action="premium"]').addEventListener("click", () => this.checkout("premium_lifetime_pass", false, this.querySelector('[data-field="premium-platform"]').value, this.querySelector('[data-field="premium-desktop"]').value));
    this.querySelector('[data-action="discounted-premium"]').addEventListener("click", () => this.checkout("premium_lifetime_pass", true, this.querySelector('[data-field="premium-platform"]').value, this.querySelector('[data-field="premium-desktop"]').value));
    this.querySelector('[data-action="portal"]').addEventListener("click", () => this.openPortal());
    this.querySelector('[data-action="restore"]').addEventListener("click", () => this.restorePurchases());
    this.querySelector('[data-action="revoke-sessions"]').addEventListener("click", () => this.revokeSessions());
    this.querySelector('[data-action="delete-account"]').addEventListener("click", () => this.deleteAccount());
    this.querySelector('[data-action="link-google"]').addEventListener("click", () => this.linkProvider(new GoogleAuthProvider()));
    this.querySelector('[data-action="link-apple"]').addEventListener("click", () => this.linkProvider(appleProvider()));
    this.querySelector('[data-action="link-email"]').addEventListener("click", () => this.linkEmail());
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
    for (const action of ["monthly", "polyglot", "premium", "discounted-premium", "portal"]) {
      this.querySelector(`[data-action="${action}"]`).disabled = !config.checkoutEnabled;
    }
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
      this.status(`Signed in with ${providerId === "apple.com" ? "Apple" : "Google"} in the safe demo.`);
      return;
    }
    this.status("Opening secure sign-in…");
    try {
      await signInWithPopup(this.auth, provider);
    } catch (error) {
      if (error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(this.auth, provider);
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
    if (!user) { this.status("Sign in to sync purchases and cloud saves across platforms."); return; }
    this.status(`Signed in as ${user.email || "your WonderLang account"}`);
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
      this.querySelector('[data-field="providers"]').textContent = (this.account.linkedLoginProviders || []).map((provider) => provider.replace(".com", "")).join(", ") || "Email link";
      const sub = this.account.subscription;
      const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : null;
      this.querySelector('[data-field="subscription"]').textContent = !sub ? "None" : `${sub.phase}${sub.trialEndsAt ? ` · trial ends ${date(sub.trialEndsAt)}` : sub.graceEndsAt ? ` · grace ends ${date(sub.graceEndsAt)}` : sub.renewsAt ? ` · renews ${date(sub.renewsAt)}` : sub.endsAt ? ` · ends ${date(sub.endsAt)}` : ""}`;
      const cloud = this.account.cloudSave;
      this.querySelector('[data-field="cloud-status"]').textContent = `${cloud.slotCount} saved slot${cloud.slotCount === 1 ? "" : "s"}${cloud.lastUpdatedAt ? ` · last sync ${date(cloud.lastUpdatedAt)}` : ""}`;
      this.querySelector('[data-field="mobile-platforms"]').textContent = (ent.mobilePlatforms || []).map((platform) => platform === "ios" ? "iOS" : "Android").join(", ") || "None";
      this.querySelector('[data-field="desktop-access"]').textContent = ent.pcMacAccess ? "Included" : "Not included";
      const subscribed = ent.accessKind === "subscription";
      this.querySelector('[data-field="cancel-confirm"]').hidden = !subscribed;
      this.querySelector('[data-action="monthly"]').disabled = !this.config.checkoutEnabled || subscribed || ent.premiumLifetime;
      this.querySelector('[data-action="polyglot"]').disabled = !this.config.checkoutEnabled || ent.premiumLifetime;
      this.querySelector('[data-action="premium"]').disabled = !this.config.checkoutEnabled || ent.premiumLifetime;
      this.querySelector('[data-action="discounted-premium"]').hidden = !this.account.legacyLifetimeDiscount.eligible || ent.premiumLifetime;
      this.querySelector('[data-action="discounted-premium"]').disabled = !this.config.checkoutEnabled || ent.premiumLifetime;
      this.querySelector('[data-action="portal"]').disabled = !this.config.checkoutEnabled;
    } catch (error) { this.fail(error); }
  }

  async checkout(product, useDiscount, mobilePlatform, desktopDelivery) {
    const subscribed = this.account?.entitlements?.accessKind === "subscription";
    const confirmation = this.querySelector('[data-field="cancel-confirm"] input');
    if (product === "premium_lifetime_pass" && subscribed && !confirmation.checked) {
      this.status("Confirm subscription cancellation before starting the Premium Lifetime checkout.");
      confirmation.focus();
      return;
    }
    if (demoMode) {
      const offer = product === "mobile_full_monthly" ? "monthly subscription"
        : product === "mobile_polyglot_permanent" ? `${mobilePlatform} Polyglot Permanent purchase`
          : useDiscount ? "discounted Premium Lifetime purchase" : "Premium Lifetime purchase";
      this.status(`Safe demo: ${offer} checkout validated. No payment page was opened.`);
      return;
    }
    try {
      const result = await this.request("/api/v1/checkout", {
        method: "POST",
        body: {
          product,
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
    try { location.assign((await this.request("/api/v1/billing-portal", { method: "POST", body: {} })).url); }
    catch (error) { this.fail(error); }
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
    const headers = { "content-type": "application/json" };
    if (options.authenticated !== false) {
      if (!this.auth?.currentUser) throw new Error("Sign in first.");
      headers.authorization = `Bearer ${await this.auth.currentUser.getIdToken()}`;
    }
    const response = await fetch(`${this.apiBase}${path}`, {
      method: options.method || "GET", headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  demoRequest(path) {
    if (path === "/api/v1/config") return demoConfig;
    if (path === "/api/v1/me/deletion-preview") {
      return {
        previewId: "demo-deletion-preview",
        confirmationPhrase: "DELETE WONDERLANG ACCOUNT",
        recoveryDays: 14,
        consequences: ["Login sessions will be revoked.", "Cloud saves will be queued for deletion.", "Purchase records remain for accounting and restore fraud prevention."]
      };
    }
    if (path === "/api/v1/me/deletion-commit") {
      return { deleteAfter: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() };
    }
    if (path === "/api/v1/me/revoke-sessions") return { revoked: true };
    if (path === "/api/v1/legacy/claim") {
      this.demoAccount.legacyLifetimeDiscount.eligible = true;
      return { eligible: true };
    }
    if (path === "/api/v1/me") return this.demoAccount;
    throw new Error(`The safe demo does not implement ${path}.`);
  }

  status(message) { this.querySelector(".wl-status").textContent = message; }
  fail(error) { console.error(error); this.status(error?.message || "Something went wrong. Please try again."); }
}

customElements.define("wonderlang-account", WonderLangAccount);
