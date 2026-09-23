import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../integrations/rmmz/WonderLangAccountCloudSync.js", import.meta.url), "utf8");
const viewFunctions = source.slice(source.indexOf("  function finishAndroidSignInView"), source.indexOf("  function confirmSignOut"));
const nativeCallback = source.slice(source.indexOf("    _nativeAccount(payload)"), source.indexOf("    _nativePurchaseVerified(payload)"));

function fixture() {
  const context: Record<string, any> = {
    activeOverlay: null,
    runtimeMobilePlatform: () => "android",
    accountUid: () => "signed-in-uid",
    showPanel: vi.fn(() => { context.activeOverlay = { dataset: {} }; return context.activeOverlay; }),
    openAccountPanel: vi.fn(async () => { context.activeOverlay = { dataset: { wlAccountView: "account" } }; }),
    tr: (_key: string, fallback: string) => fallback, escapeHtml: (s: string) => s,
    beginSignIn: vi.fn(), closeOverlay: vi.fn(), showError: vi.fn(),
    bridge: () => ({}), cache: vi.fn(), window: { dispatchEvent: vi.fn() },
    CustomEvent: class { constructor(public type: string, public options: unknown) {} },
    activeProfileId: () => "default", scheduleStartupProfileCheck: vi.fn(),
    ensureProfileSelection: vi.fn(async () => undefined), console
  };
  const api = runInNewContext(`${viewFunctions}; ({ showSignInIntro, ${nativeCallback} })`, context);
  return { api, context };
}
const account = { uid: "signed-in-uid", entitlements: { cloudSave: true, premiumLifetime: true } };

describe("Android native login screen completion", () => {
  it("replaces the sign-in intro after a confirmed native account and only does so once", () => {
    const { api, context } = fixture();
    api.showSignInIntro();
    expect(context.activeOverlay.dataset.wlAccountView).toBe("sign-in");
    api._nativeAccount(JSON.stringify(account));
    expect(context.cache).toHaveBeenCalledWith(account);
    expect(context.openAccountPanel).toHaveBeenCalledOnce();
    expect(context.ensureProfileSelection).not.toHaveBeenCalled();
    api._nativeAccount(account);
    expect(context.openAccountPanel).toHaveBeenCalledOnce();
  });
  it("waits for the correct, fully loaded native account", () => {
    const { api, context } = fixture();
    api.showSignInIntro();
    api._nativeAccount({ ...account, _nativeAccountStatus: "loading" });
    api._nativeAccount({ ...account, uid: "previous-user" });
    api._nativeAccount({ entitlements: {} });
    expect(context.openAccountPanel).not.toHaveBeenCalled();
    api._nativeAccount(account);
    expect(context.openAccountPanel).toHaveBeenCalledOnce();
  });
  it("does not reopen a dismissed intro or replace save decisions during background refresh", () => {
    const { api, context } = fixture();
    api._nativeAccount(account);
    context.activeOverlay = { dataset: { wlAccountView: "save-conflict" } };
    api._nativeAccount(account);
    expect(context.openAccountPanel).not.toHaveBeenCalled();
  });
  it("leaves desktop and iOS sign-in completion to their existing flows", () => {
    const { api, context } = fixture();
    for (const platform of ["desktop", "ios"]) {
      context.runtimeMobilePlatform = () => platform;
      api.showSignInIntro(); api._nativeAccount(account);
    }
    expect(context.openAccountPanel).not.toHaveBeenCalled();
  });
});
