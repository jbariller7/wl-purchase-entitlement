import { initializeApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "firebase/auth";
import "./wonderlang-account.css";

const localDemo = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? new URLSearchParams(location.search).get("demo")
  : null;

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
      </div>
      <div class="wl-offers">
        <article>
          <p class="wl-eyebrow">FLEXIBLE</p><h3>Monthly full access</h3>
          <p><strong data-field="monthly-price">Loading price…</strong> · <span data-field="monthly-trial">3 days free</span> · Every chapter · Every language · Cloud save</p>
          <button type="button" data-action="monthly">Start monthly</button>
        </article>
        <article>
          <p class="wl-eyebrow">KEEP FOREVER</p><h3>Lifetime full access</h3>
          <p><strong data-field="lifetime-price">Loading price…</strong> · Every chapter · Every language · Cloud save · One payment</p>
          <label class="wl-confirm" data-field="cancel-confirm" hidden>
            <input type="checkbox"> Cancel my current Stripe subscription after the lifetime payment succeeds.
          </label>
          <button type="button" data-action="lifetime">Buy lifetime</button>
          <button type="button" data-action="discounted-lifetime" hidden>Use my 50% desktop-customer offer</button>
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
      </div>
      <details>
        <summary>Already bought a Steam or Itch key on wonderlang.net?</summary>
        <p>Link the paid Stripe checkout from your receipt. It does not unlock mobile by itself; it enables one private, single-use 50% lifetime offer.</p>
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

class WonderLangAccount extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = html;
    this.apiBase = (this.getAttribute("api-base") || location.origin).replace(/\/$/, "");
    this.bind();
    if (localDemo === "email-link") {
      this.querySelector(".wl-signed-out").hidden = false;
      this.status("Local cross-device sign-in preview.");
      const email = await this.confirmEmailForLink();
      this.status(email ? `Confirmed ${email} in the local preview.` : "Email confirmation canceled in the local preview.");
      return;
    }
    try {
      const config = await this.request("/api/v1/config", { authenticated: false });
      this.config = config;
      const price = (offer, suffix = "") => `${new Intl.NumberFormat(undefined, { style: "currency", currency: offer.currency }).format(offer.unitAmount / 100)}${suffix}`;
      this.querySelector('[data-field="monthly-price"]').textContent = price(config.catalog.monthly, "/month");
      this.querySelector('[data-field="monthly-trial"]').textContent = `${Number(config.catalog.trialDays || 3)} days free`;
      this.querySelector('[data-field="lifetime-price"]').textContent = price(config.catalog.lifetime);
      for (const action of ["monthly", "lifetime", "discounted-lifetime", "portal"]) {
        this.querySelector(`[data-action="${action}"]`).disabled = !config.checkoutEnabled;
      }
      this.auth = getAuth(initializeApp(config.firebase));
      await this.finishEmailLink();
      await getRedirectResult(this.auth).catch((error) => { throw error; });
      onAuthStateChanged(this.auth, (user) => this.renderUser(user));
    } catch (error) { this.fail(error); }
  }

  bind() {
    this.querySelector('[data-action="google"]').addEventListener("click", () => this.provider(new GoogleAuthProvider()));
    this.querySelector('[data-action="apple"]').addEventListener("click", () => this.provider(appleProvider()));
    this.querySelector('[data-action="sign-out"]').addEventListener("click", () => signOut(this.auth));
    this.querySelector('[data-action="monthly"]').addEventListener("click", () => this.checkout("mobile_full_monthly", false));
    this.querySelector('[data-action="lifetime"]').addEventListener("click", () => this.checkout("mobile_full_lifetime", false));
    this.querySelector('[data-action="discounted-lifetime"]').addEventListener("click", () => this.checkout("mobile_full_lifetime", true));
    this.querySelector('[data-action="portal"]').addEventListener("click", () => this.openPortal());
    this.querySelector('[data-action="restore"]').addEventListener("click", () => this.restorePurchases());
    this.querySelector('[data-action="revoke-sessions"]').addEventListener("click", () => this.revokeSessions());
    this.querySelector('[data-action="delete-account"]').addEventListener("click", () => this.deleteAccount());
    this.querySelector('[data-action="link-google"]').addEventListener("click", () => this.linkProvider(new GoogleAuthProvider()));
    this.querySelector('[data-action="link-apple"]').addEventListener("click", () => this.linkProvider(appleProvider()));
    this.querySelector('[data-form="email"]').addEventListener("submit", (event) => this.emailLink(event));
    this.querySelector('[data-form="legacy"]').addEventListener("submit", (event) => this.claimLegacy(event));
  }

  async provider(provider) {
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
    try {
      await sendSignInLinkToEmail(this.auth, email, { url: location.href, handleCodeInApp: true });
      localStorage.setItem("wl-email-link", email);
      this.status("Check your email for the secure sign-in link.");
    } catch (error) { this.fail(error); }
  }

  async finishEmailLink() {
    if (!isSignInWithEmailLink(this.auth, location.href)) return;
    const email = localStorage.getItem("wl-email-link") || await this.confirmEmailForLink();
    if (!email) throw new Error("Email confirmation is required to finish sign-in.");
    await signInWithEmailLink(this.auth, email, location.href);
    localStorage.removeItem("wl-email-link");
    history.replaceState({}, document.title, location.pathname);
  }

  confirmEmailForLink() {
    return new Promise((resolve) => {
      const holder = document.createElement("div");
      const titleId = `wl-email-dialog-${crypto.randomUUID()}`;
      holder.className = "wl-modal-backdrop";
      holder.innerHTML = `<section class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <p class="wl-eyebrow">SECURE SIGN-IN</p>
        <h3 id="${titleId}">Confirm your email</h3>
        <p>This sign-in link was opened on a different browser or device. Enter the same email address that received the link.</p>
        <form class="wl-modal-form">
          <label><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
          <div><button type="button" class="wl-secondary" data-close>Cancel</button><button type="submit">Continue</button></div>
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
      const access = ent.accessKind === "lifetime" ? "Lifetime full access"
        : ent.accessKind === "subscription" ? `Monthly full access${ent.subscriptionState === "grace" ? " · payment grace" : ""}`
        : ent.accessKind === "legacy" ? `Legacy mobile access${ent.chapters.length ? ` · chapter ${ent.chapters.join(", ")}` : ""}`
        : "Free access";
      this.querySelector('[data-field="access"]').textContent = access;
      this.querySelector('[data-field="cloud"]').textContent = ent.cloudSave ? "Cloud save enabled" : "Cloud save requires monthly or lifetime access";
      this.querySelector('[data-field="email"]').textContent = this.account.email || "No email available";
      this.querySelector('[data-field="providers"]').textContent = (this.account.linkedLoginProviders || []).map((provider) => provider.replace(".com", "")).join(", ") || "Email link";
      const sub = this.account.subscription;
      const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : null;
      this.querySelector('[data-field="subscription"]').textContent = !sub ? "None" : `${sub.phase}${sub.trialEndsAt ? ` · trial ends ${date(sub.trialEndsAt)}` : sub.graceEndsAt ? ` · grace ends ${date(sub.graceEndsAt)}` : sub.renewsAt ? ` · renews ${date(sub.renewsAt)}` : sub.endsAt ? ` · ends ${date(sub.endsAt)}` : ""}`;
      const cloud = this.account.cloudSave;
      this.querySelector('[data-field="cloud-status"]').textContent = `${cloud.slotCount} saved slot${cloud.slotCount === 1 ? "" : "s"}${cloud.lastUpdatedAt ? ` · last sync ${date(cloud.lastUpdatedAt)}` : ""}`;
      const subscribed = ent.accessKind === "subscription";
      this.querySelector('[data-field="cancel-confirm"]').hidden = !subscribed;
      this.querySelector('[data-action="monthly"]').disabled = !this.config.checkoutEnabled || subscribed || ent.accessKind === "lifetime";
      this.querySelector('[data-action="lifetime"]').disabled = !this.config.checkoutEnabled || ent.accessKind === "lifetime";
      this.querySelector('[data-action="discounted-lifetime"]').hidden = !this.account.legacyLifetimeDiscount.eligible || ent.accessKind === "lifetime";
      this.querySelector('[data-action="discounted-lifetime"]').disabled = !this.config.checkoutEnabled || ent.accessKind === "lifetime";
      this.querySelector('[data-action="portal"]').disabled = !this.config.checkoutEnabled;
    } catch (error) { this.fail(error); }
  }

  async checkout(product, useDiscount) {
    const subscribed = this.account?.entitlements?.accessKind === "subscription";
    const confirmation = this.querySelector('[data-field="cancel-confirm"] input');
    if (product === "mobile_full_lifetime" && subscribed && !confirmation.checked) {
      this.status("Confirm subscription cancellation before starting the lifetime checkout.");
      confirmation.focus();
      return;
    }
    try {
      const result = await this.request("/api/v1/checkout", {
        method: "POST",
        body: {
          product,
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
    try { location.assign((await this.request("/api/v1/billing-portal", { method: "POST", body: {} })).url); }
    catch (error) { this.fail(error); }
  }

  async restorePurchases() {
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
      await signOut(this.auth);
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
      await signOut(this.auth);
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
      holder.querySelector("[data-close]").addEventListener("click", () => close(null));
      holder.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("phrase") || "").trim(); if (value === phrase) close(value); else { const input = event.currentTarget.querySelector("input"); input.setCustomValidity("The confirmation phrase does not match."); input.reportValidity(); } });
      document.addEventListener("keydown", onKeydown);
      this.append(holder);
      holder.querySelector("input").focus();
    });
  }

  async claimLegacy(event) {
    event.preventDefault();
    const checkoutSessionId = new FormData(event.currentTarget).get("checkoutSessionId").trim();
    try {
      await this.request("/api/v1/legacy/claim", { method: "POST", body: { checkoutSessionId } });
      this.status("Desktop purchase verified. Your private 50% lifetime offer is ready.");
      await this.renderUser(this.user);
    } catch (error) { this.fail(error); }
  }

  async request(path, options = {}) {
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

  status(message) { this.querySelector(".wl-status").textContent = message; }
  fail(error) { console.error(error); this.status(error?.message || "Something went wrong. Please try again."); }
}

customElements.define("wonderlang-account", WonderLangAccount);
