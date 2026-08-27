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
  const profileRecords = [
    { profileId: "default", name: "Default", currentRevision: "11111111-1111-4111-8111-111111111111" },
    { profileId: "spanish", name: "Spanish", currentRevision: "33333333-3333-4333-8333-333333333333" }
  ];
  const remoteBytes = new Map(profileRecords.map(profile => [profile.profileId, new TextEncoder().encode(JSON.stringify({
    magic: "WL_CLOUD_PROFILE",
    version: 1,
    profileId: profile.profileId,
    files: { global: "[]", file1: JSON.stringify({ system: { _saveCount: profile.profileId === "default" ? 42 : 18 }, party: { gold: profile.profileId === "default" ? 999 : 320 }, test: `${profile.name} cloud copy` }) }
  }))]));
  let simulateConflict = false;
  const deviceSaves = new Map([["global", []], ["file1", { system: { _saveCount: 44 }, party: { gold: 1200 }, test: "device copy" }]]);
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
    exists: name => deviceSaves.has(name),
    loadObject: async name => deviceSaves.get(name),
    saveObject: async (name, object) => { deviceSaves.set(name, object); },
    remove: name => { deviceSaves.delete(name); },
    objectToJson: async object => JSON.stringify(object),
    jsonToObject: async value => JSON.parse(value)
  };
  window.WLAccountManager = {
    getCachedIdToken: () => "mock-firebase-id-token",
    refreshIdToken: () => true,
    openSignIn: () => {
      status().textContent = "Showing a simulated PC/Mac device code. No account request is made.";
      window.dispatchEvent(new CustomEvent("wl-device-sign-in-state", { detail: { state: "starting" } }));
      setTimeout(() => window.dispatchEvent(new CustomEvent("wl-device-sign-in-state", {
        detail: {
          state: "pending",
          userCode: "ABCD-2345",
          verificationUrl: "https://wl-purchase-entitlement.netlify.app/account/?demo=1&device_code=ABCD-2345",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }
      })), 120);
      return true;
    },
    cancelSignIn: () => {
      window.dispatchEvent(new CustomEvent("wl-device-sign-in-state", { detail: { state: "cancelled" } }));
      status().textContent = "Simulated device sign-in cancelled.";
      return true;
    },
    openAccount: () => { status().textContent = "Native login-method manager requested (mock)."; return true; },
    openExternalUrl: url => { status().textContent = `External billing URL allowed in mock:\n${url}`; return true; }
  };

  window.fetch = async (input, options = {}) => {
    const url = String(input);
    const method = String(options.method || "GET").toUpperCase();
    if (url === "https://mock-upload.test/profile" && method === "PUT") return new Response("", { status: 200 });
    if (url.startsWith("https://mock-download.test/")) return new Response(remoteBytes.get(decodeURIComponent(url.split("/").pop())) || new Uint8Array(), { status: 200 });
    if (url.endsWith("/api/v1/me")) return json(account);
    if (url.endsWith("/api/v1/billing-portal")) return json({ url: "https://billing.stripe.com/p/session/test" }, 201);
    if (url.endsWith("/api/v1/cloud-save-profiles") && method === "GET") return json({ profiles: await Promise.all(profileRecords.map(async profile => {
      const bytes = remoteBytes.get(profile.profileId);
      return { ...profile, byteLength: bytes.byteLength, sha256: await sha256Hex(bytes), createdAt: new Date(Date.now() - 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 180_000).toISOString() };
    })) });
    const downloadMatch = url.match(/\/api\/v1\/cloud-save-profiles\/([^/]+)\/download$/);
    if (downloadMatch) {
      const profileId = decodeURIComponent(downloadMatch[1]);
      const profile = profileRecords.find(item => item.profileId === profileId);
      const bytes = remoteBytes.get(profileId);
      return json({ downloadUrl: `https://mock-download.test/${encodeURIComponent(profileId)}`, manifest: { ...profile, byteLength: bytes.byteLength, sha256: await sha256Hex(bytes), updatedAt: new Date(Date.now() - 180_000).toISOString() } });
    }
    if (/\/api\/v1\/cloud-save-profiles\/[^/]+\/prepare-upload$/.test(url)) return json({ uploadId: "22222222-2222-4222-8222-222222222222", uploadUrl: "https://mock-upload.test/profile", expiresAt: new Date(Date.now() + 600_000).toISOString() }, 201);
    if (/\/api\/v1\/cloud-save-profiles\/[^/]+\/finalize$/.test(url)) {
      if (simulateConflict) {
        simulateConflict = false;
        return json({ error: "Cloud-profile conflict: current revision changed." }, 409);
      }
      return json({ currentRevision: "44444444-4444-4444-8444-444444444444", updatedAt: new Date().toISOString() });
    }
    return json({ error: `Unhandled mock request: ${method} ${url}` }, 404);
  };

  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("open-device-signin").addEventListener("click", () => {
      window.WLAccountEntitlements.openSignIn();
    });
    document.getElementById("open-account").addEventListener("click", async () => {
      status().textContent = "Opening account panel with an active monthly test entitlement…";
      await window.WLAccountEntitlements.openAccount();
    });
    document.getElementById("open-saves").addEventListener("click", async () => {
      status().textContent = "Opening the whole-profile cloud-save manager…";
      await window.WLAccountEntitlements.refresh();
      await window.WLAccountEntitlements.openCloudSaves();
    });
    document.getElementById("open-conflict").addEventListener("click", async () => {
      status().textContent = "Simulating HTTP 409 after upload. No real save is touched.";
      await window.WLAccountEntitlements.refresh();
      localStorage.setItem("wl-cloud-active-profile-v1:ui_test_user", "default");
      simulateConflict = true;
      await window.WLAccountEntitlements.uploadActiveProfile();
    });
  });
})();
