/*:
 * @target MZ
 * @plugindesc Disposable isolated-build probe for the WonderLang PC/Mac account integration.
 * @author WonderLang
 *
 * @param ApiBaseUrl
 * @text Account API URL
 * @type string
 * @default https://wl-purchase-entitlement.netlify.app
 *
 * @param ExitWhenDone
 * @text Exit after writing the probe
 * @type boolean
 * @default true
 *
 * @help
 * TEST BUILD ONLY. The guarded desktop-build preparation script installs this
 * plugin after the account bridge and cloud-sync plugin. It refuses to write
 * unless the executable is beside the managed disposable-build marker.
 */
(() => {
  "use strict";

  const pluginName = "WonderLangDesktopRuntimeProbe";
  const params = PluginManager.parameters(pluginName);
  const apiBase = String(params.ApiBaseUrl || "https://wl-purchase-entitlement.netlify.app").replace(/\/$/, "");
  const exitWhenDone = String(params.ExitWhenDone || "true") === "true";
  const fatalErrors = [];
  const consoleProblems = [];
  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  window.addEventListener("error", event => {
    fatalErrors.push(String(event.error?.stack || event.message || "Unknown window error").slice(0, 2000));
  });
  window.addEventListener("unhandledrejection", event => {
    fatalErrors.push(String(event.reason?.stack || event.reason || "Unknown promise rejection").slice(0, 2000));
  });
  console.error = (...args) => {
    consoleProblems.push({ level: "error", text: args.map(safeText).join(" ").slice(0, 1000) });
    originalConsoleError(...args);
  };
  console.warn = (...args) => {
    consoleProblems.push({ level: "warning", text: args.map(safeText).join(" ").slice(0, 1000) });
    originalConsoleWarn(...args);
  };

  function safeText(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); }
    catch (_) { return String(value); }
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitFor(predicate, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await delay(100);
    }
    throw new Error("The WonderLang runtime did not reach the expected ready state.");
  }

  function requireNode(name) {
    if (typeof require !== "function") throw new Error("NW.js Node access is unavailable.");
    return require(name);
  }

  function resolveManagedBuild() {
    const fs = requireNode("fs");
    const path = requireNode("path");
    const root = path.resolve(process.cwd());
    const markerPath = path.join(root, ".wl-rmmz-test-build.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker.kind !== "wonderlang-rmmz-desktop-entitlement-test" || path.resolve(marker.targetRoot) !== path.resolve(root)) {
      throw new Error("Runtime probe refused to run outside its managed disposable build.");
    }
    return { fs, path, root, marker };
  }

  async function deployedConfigurationState() {
    try {
      const response = await fetch(`${apiBase}/api/v1/device-sign-in/config`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit"
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        ok: response.ok,
        firebaseProjectId: typeof body.firebaseProjectId === "string" ? body.firebaseProjectId : "",
        hasFirebaseApiKey: typeof body.firebaseApiKey === "string" && body.firebaseApiKey.length >= 20,
        error: response.ok ? "" : String(body.error || "Configuration request failed.").slice(0, 500)
      };
    } catch (error) {
      return { status: 0, ok: false, firebaseProjectId: "", hasFirebaseApiKey: false, error: safeText(error).slice(0, 500) };
    }
  }

  async function deployedPendingDeviceSignInState() {
    try {
      const startResponse = await fetch(`${apiBase}/api/v1/device-sign-in/start`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceLabel: "WonderLang disposable NW.js runtime probe" })
      });
      const start = await startResponse.json().catch(() => ({}));
      const validCode = typeof start.userCode === "string" && /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(start.userCode);
      const validSecret = typeof start.pollSecret === "string" && /^[A-Za-z0-9_-]{43}$/.test(start.pollSecret);
      const validVerificationUrl = typeof start.verificationUrl === "string"
        && start.verificationUrl.startsWith(`${apiBase}/account/`);
      if (!startResponse.ok || !validCode || !validSecret) {
        return {
          startStatus: startResponse.status,
          startContractValid: false,
          verificationUrlValid: validVerificationUrl,
          pollStatus: 0,
          pollState: "",
          customTokenIssuedBeforeApproval: false,
          error: String(start.error || "Device sign-in start contract was invalid.").slice(0, 500)
        };
      }

      const pollResponse = await fetch(`${apiBase}/api/v1/device-sign-in/poll`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: start.userCode, pollSecret: start.pollSecret })
      });
      const poll = await pollResponse.json().catch(() => ({}));
      return {
        startStatus: startResponse.status,
        startContractValid: true,
        verificationUrlValid: validVerificationUrl,
        pollStatus: pollResponse.status,
        pollState: typeof poll.state === "string" ? poll.state : "",
        customTokenIssuedBeforeApproval: typeof poll.customToken === "string" && poll.customToken.length > 0,
        error: pollResponse.ok ? "" : String(poll.error || "Device sign-in poll failed.").slice(0, 500)
      };
    } catch (error) {
      return {
        startStatus: 0,
        startContractValid: false,
        verificationUrlValid: false,
        pollStatus: 0,
        pollState: "",
        customTokenIssuedBeforeApproval: false,
        error: safeText(error).slice(0, 500)
      };
    }
  }

  async function simulatedBridgeFailure() {
    const manager = window.WLAccountManager;
    const events = [];
    const listener = event => events.push(event.detail || {});
    const originalFetch = window.fetch;
    window.addEventListener("wl-device-sign-in-state", listener);
    window.fetch = async () => new Response(
      JSON.stringify({ error: { message: "PC/Mac device sign-in is disabled in this deployment." } }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
    try {
      const accepted = manager.openSignIn();
      const deadline = Date.now() + 5_000;
      while (!events.some(event => event.state === "error") && Date.now() < deadline) await delay(25);
      return {
        accepted,
        events,
        signedIn: Boolean(manager.isSignedInFromGame()),
        cachedIdTokenPresent: Boolean(manager.getCachedIdToken())
      };
    } finally {
      window.fetch = originalFetch;
      window.removeEventListener("wl-device-sign-in-state", listener);
    }
  }

  async function run() {
    const managed = resolveManagedBuild();
    const reportPath = managed.path.join(managed.root, "runtime-probe.json");
    const progressPath = managed.path.join(managed.root, "runtime-probe-progress.json");
    const report = {
      kind: "wonderlang-rmmz-desktop-runtime-probe",
      version: 1,
      startedAt: new Date().toISOString(),
      completed: false
    };
    const writeProgress = stage => managed.fs.writeFileSync(
      progressPath,
      `${JSON.stringify({ stage, at: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
    try {
      writeProgress("waiting-document");
      await waitFor(() => document.readyState === "complete");
      writeProgress("waiting-account-plugins");
      await waitFor(() => typeof window.WLAccountManager === "object" && typeof window.WLAccountEntitlements === "object");
      writeProgress("waiting-rpg-maker-scene");
      await waitFor(() => Boolean(window.SceneManager?._scene));
      const sceneReady = true;
      const names = Array.isArray(PluginManager._scripts) ? PluginManager._scripts : [];
      report.runtime = {
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        sceneReady,
        scene: window.SceneManager?._scene?.constructor?.name || "",
        isNwjs: Boolean(window.Utils?.isNwjs?.()),
        executablePath: process.execPath,
        applicationRoot: managed.root,
        applicationDataPath: window.nw?.App?.dataPath || "",
        accountManagerLoaded: typeof window.WLAccountManager === "object",
        entitlementsLoaded: typeof window.WLAccountEntitlements === "object",
        signedIn: Boolean(window.WLAccountManager.isSignedInFromGame()),
        cachedIdTokenPresent: Boolean(window.WLAccountManager.getCachedIdToken()),
        bridgePluginIndex: names.indexOf("WonderLangDesktopAccountBridge"),
        cloudPluginIndex: names.indexOf("WonderLangAccountCloudSync"),
        probePluginIndex: names.indexOf(pluginName),
        bridgeApiBaseUrl: PluginManager.parameters("WonderLangDesktopAccountBridge").ApiBaseUrl || "",
        cloudApiBaseUrl: PluginManager.parameters("WonderLangAccountCloudSync").ApiBaseUrl || ""
      };
      writeProgress("checking-deployed-fail-closed");
      report.deployedFailClosed = await deployedConfigurationState();
      writeProgress("checking-deployed-pending-device-sign-in");
      report.deployedPendingDeviceSignIn = await deployedPendingDeviceSignInState();
      writeProgress("checking-simulated-bridge-failure");
      report.simulatedBridgeFailure = await simulatedBridgeFailure();
      await delay(500);
      const overlay = document.querySelector(".wl-account-overlay");
      const panel = overlay?.querySelector(".wl-account-panel");
      const panelRect = panel?.getBoundingClientRect();
      report.accountOverlay = {
        exists: Boolean(overlay),
        title: panel?.querySelector("h2")?.textContent || "",
        text: panel?.textContent?.replace(/\s+/g, " ").trim().slice(0, 1000) || "",
        display: overlay ? getComputedStyle(overlay).display : "",
        visibility: overlay ? getComputedStyle(overlay).visibility : "",
        width: panelRect?.width || 0,
        height: panelRect?.height || 0
      };
      report.completed = true;
    } catch (error) {
      report.error = safeText(error).slice(0, 3000);
    } finally {
      report.finishedAt = new Date().toISOString();
      report.fatalErrors = fatalErrors;
      report.consoleProblems = consoleProblems;
      managed.fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      writeProgress("finished");
      window.__WLDesktopRuntimeProbe = report;
      if (exitWhenDone) setTimeout(() => window.nw?.App?.quit?.(), 250);
    }
  }

  if (document.readyState === "complete") setTimeout(() => run(), 0);
  else window.addEventListener("load", () => run(), { once: true });
})();
