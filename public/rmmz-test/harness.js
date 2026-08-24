(() => {
  "use strict";
  const account = {
    uid: "ui_test_user",
    email: "player@example.com",
    entitlements: {
      fullGame: true,
      allLanguages: true,
      cloudSave: true,
      accessKind: "subscription",
      subscriptionState: "active",
      computedAt: new Date().toISOString(),
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      chapters: [1, 2, 3, 4]
    }
  };
  const remoteSave = { system: { _saveCount: 42 }, party: { gold: 999 }, test: "cloud copy" };
  const remoteBytes = new TextEncoder().encode(JSON.stringify(remoteSave));
  let deviceSave = { system: { _saveCount: 44 }, party: { gold: 1200 }, test: "device copy" };
  const status = () => document.getElementById("status");
  const json = (value, statusCode = 200) => new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { "content-type": "application/json" }
  });
  const sha256Hex = async bytes => {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  };

  window.PluginManager = {
    parameters: () => ({ ApiBaseUrl: "https://wl-purchase-entitlement.netlify.app" }),
    registerCommand: () => undefined
  };
  window.DataManager = {
    makeSavename: id => `file${id}`,
    savefileInfo: id => id === 1 ? { title: "WonderLang", timestamp: Date.now() - 90_000 } : null,
    saveGame: async () => true
  };
  window.StorageManager = {
    loadObject: async () => deviceSave,
    saveObject: async (_name, object) => { deviceSave = object; }
  };
  window.WLAccountManager = {
    getCachedIdToken: () => "mock-firebase-id-token",
    refreshIdToken: () => true,
    openSignIn: () => { status().textContent = "Native sign-in dialog requested (mock)."; return true; },
    openAccount: () => { status().textContent = "Native login-method manager requested (mock)."; return true; },
    openExternalUrl: url => { status().textContent = `External billing URL allowed in mock:\n${url}`; return true; }
  };

  window.fetch = async (input, options = {}) => {
    const url = String(input);
    const method = String(options.method || "GET").toUpperCase();
    if (url === "https://mock-upload.test/save1" && method === "PUT") return new Response("", { status: 200 });
    if (url === "https://mock-download.test/save1") return new Response(remoteBytes, { status: 200 });
    if (url.endsWith("/api/v1/me")) return json(account);
    if (url.endsWith("/api/v1/billing-portal")) return json({ url: "https://billing.stripe.com/p/session/test" }, 201);
    if (url.endsWith("/api/v1/cloud-saves") && method === "GET") return json({ saves: [{ uid: account.uid, slot: "save1", currentRevision: "11111111-1111-4111-8111-111111111111", byteLength: remoteBytes.byteLength, sha256: await sha256Hex(remoteBytes), updatedAt: new Date(Date.now() - 180_000).toISOString() }] });
    if (url.endsWith("/api/v1/cloud-saves/save1")) return json({ downloadUrl: "https://mock-download.test/save1", manifest: { uid: account.uid, slot: "save1", currentRevision: "11111111-1111-4111-8111-111111111111", byteLength: remoteBytes.byteLength, sha256: await sha256Hex(remoteBytes), updatedAt: new Date(Date.now() - 180_000).toISOString() } });
    if (url.endsWith("/api/v1/cloud-saves/prepare-upload")) return json({ uploadId: "22222222-2222-4222-8222-222222222222", uploadUrl: "https://mock-upload.test/save1", expiresAt: new Date(Date.now() + 600_000).toISOString() }, 201);
    if (url.endsWith("/api/v1/cloud-saves/finalize")) return json({ error: "Cloud-save conflict: current revision changed." }, 409);
    return json({ error: `Unhandled mock request: ${method} ${url}` }, 404);
  };

  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("open-account").addEventListener("click", async () => {
      status().textContent = "Opening account panel with an active monthly test entitlement…";
      await window.WLAccountEntitlements.openAccount();
    });
    document.getElementById("open-saves").addEventListener("click", async () => {
      status().textContent = "Opening cloud-save list with one device/cloud slot…";
      await window.WLAccountEntitlements.refresh();
      await window.WLAccountEntitlements.openCloudSaves();
    });
    document.getElementById("open-conflict").addEventListener("click", async () => {
      status().textContent = "Simulating HTTP 409 after upload. No real save is touched.";
      await window.WLAccountEntitlements.refresh();
      await window.WLAccountEntitlements.uploadSlot(1);
    });
  });
})();
