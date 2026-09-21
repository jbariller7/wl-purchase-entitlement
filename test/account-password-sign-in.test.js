import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function setup() {
  const source = readFileSync(new URL("../integrations/web/account-widget/wonderlang-account.js", import.meta.url), "utf8");
  const methods = source.slice(source.indexOf("  async passwordSignIn(event)"), source.indexOf("  async emailLink(event)"));
  const button = { disabled: false };
  const form = { querySelector: () => button, reset: vi.fn() };
  const context = { demoMode: false, FormData: class { get(key) { return key === "email" ? " reviewer@example.com " : "example-test-only-password"; } },
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: { uid: "reviewer" } }) };
  vm.createContext(context);
  vm.runInContext(`class Widget {${methods}}; this.widget = new Widget();`, context);
  const widget = context.widget;
  Object.assign(widget, { auth: {}, desktopHandoff: { userCode: "code" }, renderUser: vi.fn(), fail: vi.fn() });
  return { context, widget, button, form, event: { preventDefault: vi.fn(), currentTarget: form } };
}
it("completes the existing desktop handoff after password authentication and clears the password form", async () => {
  const f = setup();
  await f.widget.passwordSignIn(f.event);
  expect(f.context.signInWithEmailAndPassword).toHaveBeenCalledWith(f.widget.auth, "reviewer@example.com", "example-test-only-password");
  expect(f.widget.handoffReady).toBe(true);
  expect(f.widget.renderUser).toHaveBeenCalledWith({ uid: "reviewer" });
  expect(f.form.reset).toHaveBeenCalledOnce();
  expect(f.button.disabled).toBe(false);
});
it("keeps failed authentication out of the handoff and allows retry", async () => {
  const f = setup();
  f.context.signInWithEmailAndPassword.mockRejectedValue(new Error("invalid credential"));
  await f.widget.passwordSignIn(f.event);
  expect(f.widget.handoffReady).not.toBe(true);
  expect(f.widget.renderUser).not.toHaveBeenCalled();
  expect(f.widget.fail).toHaveBeenCalledOnce();
  expect(f.button.disabled).toBe(false);
});
