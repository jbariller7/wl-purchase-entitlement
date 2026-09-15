import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { dictionaries, languages, translateSummary } from "../integrations/web/account-widget/account-languages.js";
import { friendlyLoginProvider } from "../integrations/web/account-widget/provider-labels.js";
const source = readFileSync(new URL("../integrations/web/account-widget/wonderlang-account.js", import.meta.url), "utf8");
function widget() {
  const context = vm.createContext({HTMLElement: class {}, location: {href:""}, encodeURIComponent, demoMode: false, friendlyLoginProvider});
  vm.runInContext(source.slice(source.indexOf("class WonderLangAccount extends"), source.indexOf('customElements.define("wonderlang-account"')) + "\nglobalThis.Widget = WonderLangAccount;", context);
  const page = new context.Widget();
  let status;
  page.status = value => {status=value;};
  page.account = {email:"tester+cloud@example.com"};
  return {page, context, status:()=>status};
}
describe("account page refresh", () => {
  it("shows connected methods and only offers missing methods, including email aliases", () => {
    const {page} = widget();
    const nodes = {};
    page.querySelector = selector => nodes[selector] ||= {};
    for (const email of ["password", "email", "email-link", "passwordless-email"]) {
      page.renderSignInMethods(["google.com", email]);
      expect(nodes['[data-action="link-google"]'].hidden).toBe(true);
      expect(nodes['[data-linked-method="Google"]'].hidden).toBe(false);
      expect(nodes['[data-action="link-apple"]'].hidden).toBe(false);
      expect(nodes['[data-action="link-email"]'].hidden).toBe(true);
    }
    page.renderSignInMethods([]);
    expect(nodes['[data-action="link-google"]'].hidden).toBe(false);
    expect(nodes['[data-linked-method="Email"]'].hidden).toBe(true);
    for (const [locale] of languages) {
      for (const key of ["Sign-in methods", "Connected", "Add Google sign-in", "Add Apple sign-in", "Add email sign-in"]) expect(dictionaries[locale][key]).toBeTruthy();
    }
  });
  it("replaces purchase cards with the website and loads configuration without the removed controls", () => {
    expect(source).toContain('href="https://wonderlang.net/"');
    for (const removed of ['class="wl-offers"', 'data-action="premium"', 'data-action="discounted-premium"', 'data-field="monthly-price"', 'data-field="premium-platform"', 'data-field="cancel-confirm"']) {
      expect(source).not.toContain(removed);
    }
    const {page} = widget();
    const controls = {};
    page.querySelector = selector => controls[selector] ||= {};
    page.configureCatalog({checkoutEnabled:false,accountApiReady:true});
    expect(controls['[data-action="portal"]'].disabled).toBe(true);
    expect(controls['[data-action="delete-account"]'].disabled).toBe(false);
  });
  it("opens an email for either mobile platform without granting access or posting a request", async () => {
    const {page,context,status} = widget();
    page.request = () => {throw new Error("No backend mutation is allowed");};
    await page.requestSecondPlatform();
    const url = new URL(context.location.href);
    expect(url.pathname).toBe("wonderlang.thegame@gmail.com");
    expect(url.searchParams.get("body")).toContain("Android or iOS");
    expect(url.searchParams.get("body")).toContain("tester+cloud@example.com");
    expect(status()).toContain("Send the email");
  });
  it("uses an explicit support request if automatic deletion is disabled", async () => {
    const {page,context,status} = widget();
    page.config = {accountDeletionEnabled:false};
    page.request = () => {throw new Error("Must not disable an account");};
    await page.deleteAccount();
    expect(context.location.href).toMatch(/^mailto:wonderlang.thegame@gmail.com/);
    expect(status()).toContain("Your account has not been deleted");
  });
  it("removes the historical claim form and its bindings", () => {
    expect(source).not.toContain('data-form="legacy"');
    expect(source).not.toContain("Already bought a Steam or Itch key");
    expect(source).not.toContain("cloud.slotCount");
  });
  it("has all authored summary/profile translations and preserves unknown user strings", () => {
    const keys = Object.keys(dictionaries.en);
    expect(languages).toHaveLength(20);
    for (const [locale] of languages) {
      expect(Object.keys(dictionaries[locale])).toEqual(keys);
      for (const key of keys) expect(translateSummary(key,locale).trim().length).toBeGreaterThan(0);
    }
    expect(translateSummary("FrenchJo","fr")).toBe("FrenchJo");
  });
  it("gates preview and commit before accounts can be disabled", () => {
    const api = readFileSync(new URL("../netlify/functions/api.ts",import.meta.url),"utf8");
    for (const route of ["deletion-preview","deletion-commit"]) {
      const start = api.indexOf('path === "/v1/me/' + route + '"');
      const block = api.slice(start,api.indexOf('\n  }',start));
      expect(block).toContain("!deploymentControls().OUTBOX_PROCESSING_ENABLED");
      expect(block).toContain("!deploymentControls().ACCOUNT_DELETION_PROCESSING_ENABLED");
      expect(block).toContain("throw new HttpError(503");
    }
  });
});
