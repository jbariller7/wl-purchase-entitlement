/*:
 * @target MZ
 * @plugindesc WonderLang account UI, six save profiles, and automatic whole-profile cloud sync (test integration).
 * @author WonderLang
 *
 * @param ApiBaseUrl
 * @text Account API URL
 * @type string
 * @default https://wonderlang.app
 *
 * @param OpenOnPlaytest
 * @text Open account automatically in playtest
 * @type boolean
 * @on Yes
 * @off No
 * @default false
 *
 * @command openAccount
 * @text Open WonderLang Account
 * @desc Shows sign-in state, access, subscription, cloud saves, and account actions.
 *
 * @command openCloudSaves
 * @text Manage Save Profiles
 * @desc Selects, creates, and renames complete cloud-save profiles.
 *
 * @command refreshEntitlements
 * @text Refresh Entitlements
 * @desc Refreshes the signed-in player's server-authoritative access snapshot.
 *
 * @help
 * Duplicate/test-build integration. Keep production WonderLang files untouched until
 * this copy has passed the Android release gate and real-device testing.
 *
 * Native bridge name: WLAccountManager
 *   getCachedIdToken(), getCachedAppCheckToken(), refreshIdToken(), openSignIn(), openAccount(),
 *   openExternalUrl(url), and Firebase-auth callbacks documented below.
 *
 * Every selected profile contains all saved progress.
 * Local saves finish first, then the complete profile synchronizes automatically.
 * A revision conflict never overwrites either side without asking the player.
 * Android offline access is authorized only by a Firebase-UID-bound AES-GCM lease in
 * Android Keystore: Monthly lasts at most seven days and never beyond the known paid/grace
 * deadline; permanent and Premium access require an online recheck every 30 days.
 * Desktop verified permanent/Premium access remains available offline. Its cached Monthly
 * snapshot remains usable through its paid period or for seven days after the last refresh,
 * whichever is later; provider grace access ends at the server-provided grace deadline.
 */
(() => {
  "use strict";

  const pluginName = "WonderLangAccountCloudSync";
  const params = PluginManager.parameters(pluginName);
  const apiBase = String(params.ApiBaseUrl || "https://wonderlang.app").replace(/\/$/, "");
  const openOnPlaytest = String(params.OpenOnPlaytest || "false").toLowerCase() === "true";
  if (!/^https:\/\//i.test(apiBase)) throw new Error("WonderLang account API must use HTTPS.");

  const cacheKey = "wl-account-entitlements-v3";
  const revisionsPrefix = "wl-cloud-revisions-v3";
  const retryPrefix = "wl-cloud-upload-retry-v3";
  const activeProfilePrefix = "wl-cloud-active-profile-v1";
  const workspaceBindingKey = "wl-cloud-workspace-binding-v1";
  const OFFLINE_SUBSCRIPTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const knownMobileSkus = new Set([
    "wonderlangmonthly", "wonderlangfull",
    "wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"
  ]);
  let tokenWaiters = [];
  let current = loadJson(cacheKey, null);
  let activeOverlay = null;
  let drainingRetries = false;
  let applyingProfile = false;
  let profileSyncTimer = null;
  let profileSyncInFlight = null;
  let profileOperationTail = Promise.resolve();
  let conflictProfileId = "";
  let manualSyncInFlight = null;
  const pendingSaveWrites = new Set();
  let saveWriteGeneration = 0;
  let profileSelectionInFlight = false;
  let startupProfileCheckInFlight = null;
  let startupProfileCheckTimer = null;
  let startupProfileDecisionPending = true;
  let checkedStartupWorkspace = "";
  let failedStartupWorkspace = "";
  let menuTranslations = null;
  let networkUnavailable = navigator.onLine === false;
  let offlineNoticePending = networkUnavailable;
  let offlineNoticeShown = false;
  let reconnecting = false;
  let offlineSince = 0;
  let foregroundReadyAt = Date.now() + 5000;

  function deviceOffline() {
    try {
      if (typeof window.AndroidManager?.isOnline === "function") return !window.AndroidManager.isOnline();
    } catch (_) { /* Use the browser signal when the native bridge is unavailable. */ }
    return navigator.onLine === false;
  }
  function isOffline() { return deviceOffline() || networkUnavailable; }
  function noteOnline() {
    networkUnavailable = false;
    offlineSince = 0;
    offlineNoticePending = false;
    offlineNoticeShown = false;
  }
  function noteConnectionFailure() {
    // An API/Storage failure is not proof that the device lost its connection.
    networkUnavailable = true;
    if (deviceOffline()) noteOffline();
  }
  function titleAccountLabel() {
    if (accountUid() === "signed-out") return "";
    const binding = workspaceBinding();
    const name = binding?.uid === accountUid() && binding.profileId === activeProfileId() ? binding.profileName : "";
    return [current?.email, name].filter(Boolean).join(" · ");
  }
  function refreshTitleAccount() {
    window.dispatchEvent(new CustomEvent("wl-account-label-changed"));
  }
  function offlineMessage() {
    return tr("CloudAccount.Offline.Body", "You are offline. Saves stay on this device. Keep the game open: they will sync automatically when you reconnect. No need to save again or open your profile. If you close the game, reopen it signed in. If another device changed this profile, you will be asked which saves to keep.");
  }
  function noteOffline() {
    if (!deviceOffline()) return;
    networkUnavailable = true;
    if (!offlineSince) offlineSince = Date.now();
    if (!offlineNoticeShown) offlineNoticePending = true;
  }
  function showOfflineNotice() {
    if (document.hidden || Date.now() < foregroundReadyAt || !deviceOffline()) return;
    noteOffline();
    if (Date.now() - offlineSince < 5000 || !offlineNoticePending || activeOverlay || accountUid() === "signed-out" || !effectiveCachedEntitlement()?.cloudSave) return;
    offlineNoticePending = false; offlineNoticeShown = true;
    const panel = showPanel(tr("CloudAccount.Offline.Title", "Offline — sync paused"), `<p class="wl-account-muted">${escapeHtml(offlineMessage())}</p>`, [
      { label: "Continue", run: closeOverlay }
    ]);
    panel.dataset.syncSafe = "true";
    panel.dataset.offlineNotice = "true";
  }
  async function resumeCloudSync() {
    if (document.hidden || Date.now() < foregroundReadyAt || reconnecting || deviceOffline() || accountUid() === "signed-out" || applyingProfile || (activeOverlay && activeOverlay.dataset.syncSafe !== "true")) return;
    reconnecting = true;
    try {
      await refresh();
      if (deviceOffline() || document.hidden) { noteOffline(); return; }
      noteOnline();
      clearTimeout(startupProfileCheckTimer);
      const profileId = activeProfileId();
      if (!profileId || !effectiveCachedEntitlement()?.cloudSave) return;
      if (!workspaceMatches(profileId)) { scheduleStartupProfileCheck(50, true); return; }
      if (conflictProfileId === profileId) return;
      if (retryQueue()[profileId]) {
        startupProfileDecisionPending = false;
        checkedStartupWorkspace = `${accountUid()}:${profileId}`;
        const result = await syncActiveProfileNow();
        if (result?.conflict) startupProfileDecisionPending = true;
      } else scheduleStartupProfileCheck(50);
      if (isOffline() || document.hidden) return;
      if (!retryQueue()[profileId] && activeOverlay?.dataset.offlineNotice === "true") {
        showPanel("Cloud saves ready", `<p class="wl-account-success">${escapeHtml(tr("CloudAccount.Startup.CloudReadyBody", "{PROFILE}'s cloud saves are now active on this device.", { PROFILE: workspaceBinding()?.profileName || profileId }))}</p>`, [{ label: "Continue", run: closeOverlay }]);
      } else if (activeOverlay?.dataset.syncSafe === "true" && !retryQueue()[profileId]) {
        openAccountPanel();
      }
    } catch (error) {
      if (deviceOffline()) noteOffline();
      console.warn("[WonderLang Cloud Save] Reconnection sync paused.", safeMessage(error));
    } finally { reconnecting = false; }
  }

  function uiLanguage() {
    let code = String(globalThis.ConfigManager?.uiLanguage || globalThis.$gameVariables?.value?.(200) || "EN").trim();
    const mode = Number(globalThis.$gameVariables?.value?.(172) || 0);
    if (code.toUpperCase() === "JP") code = mode === 1 ? "JP" : "JP_hir";
    if (code.toUpperCase() === "ZH") code = mode === 1 || mode === 2 ? "ZH_hir" : mode === 3 || mode === 4 ? "ZH_trad" : "ZH";
    if (code.toUpperCase() === "AR") code = mode === 0 ? "AR" : "AR_hir";
    return code || "EN";
  }

  function loadMenuTranslations() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "texts/menu.json", false);
      xhr.overrideMimeType("application/json");
      xhr.send();
      if (xhr.status < 400) menuTranslations = (JSON.parse(xhr.responseText).translations || {});
    } catch (error) {
      console.warn("[WonderLang Account] Could not load texts/menu.json.", error);
    }
  }

  function tr(key, fallback, values = {}) {
    const language = uiLanguage();
    const candidates = [language, String(language).toUpperCase(), "EN", "US"];
    let text = fallback;
    for (const candidate of candidates) {
      const value = menuTranslations?.[candidate]?.[key];
      if (typeof value === "string" && value) { text = value; break; }
    }
    return String(text).replace(/\{([A-Z0-9_]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
  }

  function trSource(source, values = {}) {
    const aliases = {
      "All saves in your selected profile sync automatically. Create up to six profiles to keep each player's progress or each learning language separate.": "CloudAccount.Profiles.Intro",
      "You can restore one of the three previous backups of this profile. Each backup contains all the profile's saves.": "CloudAccount.Backups.Intro",
      "{PROFILE} is ready. All saves in this profile will sync automatically.": "CloudAccount.Profile.ReadyBody",
      "First, all saves for {CURRENT} on this device will be uploaded to the cloud. Then {NEXT}'s cloud saves will be downloaded to this device. If the upload fails, you will stay on {CURRENT}.": "CloudAccount.Profile.SwitchBody",
      "All saves on this device": "CloudAccount.Conflict.Device",
      "The saves on this device belong to {OWNER}, not {ACTIVE}. They will not be uploaded to {ACTIVE}. Choose their profile, or download {ACTIVE}'s cloud saves. Downloading replaces the saves on this device after keeping a recovery copy here. It does not change the saves in the cloud.": "CloudAccount.Startup.MismatchBody",
      "The saves on this device do not belong to any profile on your account. Create a new profile for them? All these saves will be uploaded to the new profile. Your other profiles will not change. Enter a name to continue.": "CloudAccount.Profile.AdoptLocalBody",
      "Your latest saves for profile “{PROFILE}” are not yet in the cloud. Upload all saves for this profile now?": "CloudAccount.Startup.NewerBody",
      "Do the saves on this device belong to {PROFILE}? Confirm only if you are sure. Otherwise, choose another profile or download this profile's cloud saves instead.": "CloudAccount.Startup.UnlabelledBody",
      "Uploading {PROFILE}'s saves to the cloud…": "CloudAccount.Startup.SyncingBody",
      "This device and the cloud have different saves for this profile. Nothing has been replaced yet. Choose which saves to keep. They will replace the other version.": "CloudAccount.Conflict.Body",
      "This device and this profile both have saves. Keep this device's saves to upload them to the profile, or use the cloud saves to replace the saves on this device. The two versions will not be combined.": "CloudAccount.Profile.ChooseBody",
      "Loading your save profiles…": "CloudAccount.Profiles.Loading",
      "Choose a profile for this device. You can keep this device's existing saves in that profile or download its cloud saves.": "CloudAccount.Profiles.FirstPick",
      "Choose a name for the player or language, such as Emma or Japanese.": "CloudAccount.Profile.NameHint",
      "Saving your latest progress to the cloud before showing older backups…": "CloudAccount.Backups.Saving",
      "No older backup is available yet. After each successful sync, WonderLang keeps up to three previous backups.": "CloudAccount.Backups.None",
      "Restore the backup from {TIME}? It will replace this profile's current cloud saves. The current version will become one of the three older backups.": "CloudAccount.Backups.RestoreConfirm",
      "{PROFILE} has been restored to the backup from {TIME}. Those saves are now on this device.": "CloudAccount.Backups.RestoredHere",
      "{PROFILE} has been restored to the backup from {TIME} in the cloud. This device will download those saves when you switch to this profile.": "CloudAccount.Backups.RestoredLater",
      "Saving this profile's progress to the cloud before switching…": "CloudAccount.Profile.Saving",
      "Loading older backups for {PROFILE}…": "CloudAccount.Backups.Checking",
      "WonderLang Cloud": "CloudAccount.UI.WonderLangCloud",
      "Secure sync": "CloudAccount.UI.Securesync",
      "WonderLang account": "CloudAccount.UI.WonderLangaccount",
      "Sign in": "CloudAccount.UI.Signin",
      "Refresh": "CloudAccount.UI.Refresh",
      "Manage login methods": "CloudAccount.UI.Manageloginmethods",
      "Manage subscription": "CloudAccount.UI.Managesubscription",
      "Access": "CloudAccount.UI.Access",
      "Subscription": "CloudAccount.UI.Subscription",
      "Save profile": "CloudAccount.UI.Saveprofile",
      "Uploads waiting": "CloudAccount.UI.Uploadswaiting",
      "Languages": "CloudAccount.UI.Languages",
      "All languages": "CloudAccount.UI.Alllanguages",
      "No active subscription": "CloudAccount.UI.Noactivesubscription",
      "Save profiles": "CloudAccount.UI.Saveprofiles",
      "Active": "CloudAccount.UI.Active",
      "Selected": "CloudAccount.UI.Selected",
      "Use profile": "CloudAccount.UI.Useprofile",
      "Restore backup": "CloudAccount.UI.Restorebackup",
      "Create profile": "CloudAccount.UI.Createprofile",
      "Back to account": "CloudAccount.UI.Backtoaccount",
      "Profile name": "CloudAccount.UI.Profilename",
      "Creating profile": "CloudAccount.UI.Creatingprofile",
      "Loading profile backups": "CloudAccount.UI.Loadingprofilebackups",
      "Saving current profile": "CloudAccount.UI.Savingcurrentprofile",
      "Back to profiles": "CloudAccount.UI.Backtoprofiles",
      "Restoring profile backup": "CloudAccount.UI.Restoringprofilebackup",
      "Backup restored": "CloudAccount.UI.Backuprestored",
      "Switching save profile": "CloudAccount.UI.Switchingsaveprofile",
      "Profile ready": "CloudAccount.UI.Profileready",
      "Account": "CloudAccount.UI.Account",
      "Sync and switch": "CloudAccount.UI.Syncandswitch",
      "Keep device saves": "CloudAccount.UI.Keepdevicesaves",
      "Use cloud saves": "CloudAccount.UI.Usecloudsaves",
      "This profile changed on two devices": "CloudAccount.UI.Thisprofilechangedontwodevices",
      "Keep this device": "CloudAccount.UI.Keepthisdevice",
      "Use cloud profile": "CloudAccount.UI.Usecloudprofile",
      "Profile": "CloudAccount.UI.Profile",
      "Active save profile": "CloudAccount.UI.Activesaveprofile",
      "Close": "CloudAccount.UI.Close",
      "Cancel": "CloudAccount.UI.Cancel",
      "Rename": "CloudAccount.UI.Rename",
      "Try again": "CloudAccount.UI.Tryagain",
      "Save": "CloudAccount.UI.Save",
      "Cloud": "CloudAccount.UI.Cloud",
      "Opening sign-in in your browser…": "CloudAccount.SignIn.Opening",
      "Use Google, Apple, or an email link to sign in through your browser. Then return to WonderLang; the game will finish signing you in automatically.": "CloudAccount.SignIn.Browser",
      "You are signed in. Loading your account and saves…": "CloudAccount.SignIn.Success",
      "Loading your account…": "CloudAccount.Account.Loading",
      "Please finish signing in before {TIME}.": "CloudAccount.SignIn.Expires",
      "Sign in to WonderLang": "CloudAccount.SignIn.Title",
      "Signed in": "CloudAccount.SignIn.Done",
      "Open sign-in page": "CloudAccount.SignIn.Open",
      "Switch to {PROFILE}?": "CloudAccount.Profile.SwitchTitle",
      "Use {PROFILE} on this device?": "CloudAccount.Profile.UseTitle",
      "Backups for {PROFILE}": "CloudAccount.Backups.Title",
      "Backup {NUMBER}": "CloudAccount.Backups.Number",
      "Saved {TIME}": "CloudAccount.Backups.Time",
      "Restore {PROFILE}'s backup?": "CloudAccount.Backups.RestoreTitle",
      "Restoring {PROFILE}'s backup from {TIME}…": "CloudAccount.Backups.Restoring",
      "Restore backup ({COUNT})": "CloudAccount.Backups.Count",
      "Creating {PROFILE}…": "CloudAccount.Profile.Creating",
      "Account refresh failed": "CloudAccount.Status.Accountrefreshfailed",
      "Account unavailable": "CloudAccount.Status.Accountunavailable",
      "Backup was not restored": "CloudAccount.Status.Backupwasnotrestored",
      "Billing portal unavailable": "CloudAccount.Status.Billingportalunavailable",
      "Cloud profile was not restored": "CloudAccount.Status.Cloudprofilewasnotrestored",
      "Cloud-profile conflict": "CloudAccount.Status.Cloudprofileconflict",
      "Could not switch profile": "CloudAccount.Status.Couldnotswitchprofile",
      "Device profile was not uploaded": "CloudAccount.Status.Deviceprofilewasnotuploaded",
      "PC/Mac sign-in failed": "CloudAccount.Status.PCMacsigninfailed",
      "Profile backups unavailable": "CloudAccount.Status.Profilebackupsunavailable",
      "Profile switch paused": "CloudAccount.Status.Profileswitchpaused",
      "Profile was not created": "CloudAccount.Status.Profilewasnotcreated",
      "Profile was not renamed": "CloudAccount.Status.Profilewasnotrenamed",
      "Save profiles unavailable": "CloudAccount.Status.Saveprofilesunavailable",
      "Sign-in unavailable": "CloudAccount.Status.Signinunavailable",
      "Cloud updated {TIME}": "CloudAccount.Status.CloudupdatedTIME",
      " · ends {TIME}": "CloudAccount.Status.endsTIME",
      " · renews {TIME}": "CloudAccount.Status.renewsTIME",
      "No cloud saves yet": "CloudAccount.Status.Nocloudsavesyet",
      "Choose a profile": "CloudAccount.Status.Chooseaprofile",
      "Not included": "CloudAccount.Status.Notincluded",
      "Full game": "CloudAccount.Status.Fullgame",
      "Free demo": "CloudAccount.Status.Freedemo",
      "Demo access": "CloudAccount.Status.Demoaccess",
      "Owned on another mobile platform": "CloudAccount.Status.Ownedonanothermobileplatform",
      "Signed-in account": "CloudAccount.Status.Signedinaccount",
      "Not available": "CloudAccount.Status.Notavailable",
      "Create": "CloudAccount.Status.Create",
      "Rename profile": "CloudAccount.Status.Renameprofile",
      "Cloud saves ready": "CloudAccount.Startup.CloudReadyTitle",
      "Your current profile could not be uploaded, so the profile was not switched. Check your internet connection and try again. {ERROR}": "CloudAccount.Error.SwitchFailedBody",
      "Continue": "CloudAccount.Action.Continue",
      "Manage profiles": "CloudAccount.Action.ManageProfiles",
      "Not now": "CloudAccount.Action.NotNow",
      "This device": "CloudAccount.Label.ThisDevice",
      "Cloud backup": "CloudAccount.Label.CloudBackup",
      "No backup yet": "CloudAccount.Label.NoBackupYet",
      "selected profile": "CloudAccount.Label.SelectedProfile",
      "These local saves are not verified as belonging to the selected profile.": "CloudAccount.Error.WorkspaceMismatch"
    };
    const text = String(source);
    return tr(aliases[text] || text, text, values);
  }

  function translateStaticTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = String(node.nodeValue || "");
      const trimmed = value.trim();
      if (!trimmed) continue;
      const translated = trSource(trimmed);
      if (translated !== trimmed) node.nodeValue = value.replace(trimmed, translated);
    }
  }

  loadMenuTranslations();

  class AccountApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AccountApiError";
      this.status = status;
    }
  }

  function bridge() { return window.WLAccountManager; }
  function runtimeMobilePlatform() {
    const userAgent = String(navigator.userAgent || navigator.vendor || "");
    if (window.AndroidManager || /Android/i.test(userAgent)) return "android";
    if (window.WLiOSManager || /iPad|iPhone|iPod/i.test(userAgent) ||
        (String(navigator.platform || "") === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1)) return "ios";
    return null;
  }
  function restrictToGrantedPlatform(value) {
    const platform = runtimeMobilePlatform();
    if (!value?.fullGame || !platform) return value;
    const allowedPlatforms = Array.isArray(value.mobilePlatforms) ? value.mobilePlatforms : [];
    if (allowedPlatforms.includes(platform)) return value;
    return {
      ...value,
      fullGame: false,
      allLanguages: false,
      cloudSave: false,
      platformRestricted: true
    };
  }
  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
    catch (_) { return fallback; }
  }
  function cache(value) {
    current = value;
    if (value) localStorage.setItem(cacheKey, JSON.stringify({ ...value, _cachedAt: Date.now() }));
    else localStorage.removeItem(cacheKey);
  }
  function nativeAndroidAccount() {
    if (runtimeMobilePlatform() !== "android") return undefined;
    const nativeBridge = bridge();
    if (!nativeBridge || typeof nativeBridge.getAccountSnapshot !== "function") return null;
    try {
      const snapshot = String(nativeBridge.getAccountSnapshot() || "");
      return snapshot ? JSON.parse(snapshot) : null;
    } catch (_) {
      return null;
    }
  }
  function authoritativeAccount() {
    const native = nativeAndroidAccount();
    // On Android, localStorage is never an entitlement authority. Only the
    // native bridge can expose an online snapshot or a keystore-validated lease.
    return native === undefined ? current : native;
  }
  function accountUid() { return String(authoritativeAccount()?.uid || "signed-out"); }
  function revisionsKey() { return `${revisionsPrefix}:${accountUid()}`; }
  function revisions() { return loadJson(revisionsKey(), {}); }
  function setRevision(slot, revision) {
    const value = revisions();
    if (revision) value[slot] = revision;
    else delete value[slot];
    localStorage.setItem(revisionsKey(), JSON.stringify(value));
  }
  function activeProfileKey() { return `${activeProfilePrefix}:${accountUid()}`; }
  function activeProfileId() { return String(localStorage.getItem(activeProfileKey()) || ""); }
  function setActiveProfileId(profileId) {
    if (profileId) localStorage.setItem(activeProfileKey(), String(profileId));
    else localStorage.removeItem(activeProfileKey());
    refreshTitleAccount();
  }
  function workspaceBinding() {
    const value = loadJson(workspaceBindingKey, null);
    return value && typeof value.uid === "string" && typeof value.profileId === "string" ? value : null;
  }
  function workspaceMatches(profileId = activeProfileId()) {
    const binding = workspaceBinding();
    return Boolean(binding && binding.uid === accountUid() && binding.profileId === profileId);
  }
  function saveWorkspaceBinding(profileId, changes = {}) {
    if (!profileId || accountUid() === "signed-out") return null;
    const previous = workspaceBinding();
    const value = {
      version: 1,
      uid: accountUid(),
      profileId,
      profileName: String(changes.profileName || (previous?.uid === accountUid() && previous?.profileId === profileId ? previous.profileName : "") || ""),
      revision: Object.prototype.hasOwnProperty.call(changes, "revision") ? changes.revision : (previous?.revision || null),
      fingerprint: Object.prototype.hasOwnProperty.call(changes, "fingerprint") ? changes.fingerprint : (previous?.fingerprint || null),
      cloudUpdatedAt: Object.prototype.hasOwnProperty.call(changes, "cloudUpdatedAt") ? changes.cloudUpdatedAt : (previous?.cloudUpdatedAt || null),
      localChangedAt: Object.prototype.hasOwnProperty.call(changes, "localChangedAt") ? changes.localChangedAt : (previous?.localChangedAt || null),
      boundAt: previous?.uid === accountUid() && previous?.profileId === profileId ? previous.boundAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(workspaceBindingKey, JSON.stringify(value));
    refreshTitleAccount();
    return value;
  }
  function noteWorkspaceChanged(profileId) {
    if (!workspaceMatches(profileId)) return false;
    saveWorkspaceBinding(profileId, { localChangedAt: new Date().toISOString() });
    return true;
  }
  function entitlement() { return authoritativeAccount()?.entitlements || null; }
  function effectiveCachedEntitlement(now = Date.now()) {
    const granted = restrictToGrantedPlatform(entitlement());
    const value = granted ? { ...granted, cloudSave: Boolean(granted.cloudSave && granted.premiumLifetime) } : granted;
    if (!value?.fullGame) return value;
    if (value.accessKind === "premium_lifetime" || value.accessKind === "permanent" || value.accessKind === "legacy") return value;
    if (value.accessKind !== "subscription") return value;
    const computedAt = Date.parse(value.computedAt || "");
    if (!Number.isFinite(computedAt) || computedAt > now + 5 * 60 * 1000) return { ...value, fullGame: false, allLanguages: false, cloudSave: false, offlineExpired: true };
    const deadline = value.subscriptionState === "grace"
      ? Date.parse(value.graceEndsAt || "")
      : Math.min(Date.parse(value.subscriptionEndsAt || "") || computedAt, computedAt + OFFLINE_SUBSCRIPTION_GRACE_MS);
    return Number.isFinite(deadline) && now < deadline
      ? value
      : { ...value, fullGame: false, allLanguages: false, cloudSave: false, offlineExpired: true };
  }
  function account() { return authoritativeAccount(); }
  function canSyncCloud() { return accountUid() !== "signed-out" && Boolean(effectiveCachedEntitlement()?.cloudSave); }
  function retryKey() { return `${retryPrefix}:${accountUid()}`; }
  function retryQueue() {
    const stored = loadJson(retryKey(), {});
    return Object.fromEntries(Object.entries(stored).filter(([, item]) => item && typeof item.profileId === "string"));
  }
  function retryCount() { return Object.keys(retryQueue()).length; }
  function saveRetryQueue(queue) {
    if (Object.keys(queue).length) localStorage.setItem(retryKey(), JSON.stringify(queue));
    else localStorage.removeItem(retryKey());
    window.dispatchEvent(new CustomEvent("wl-cloud-save-retry-state", { detail: { queued: Object.keys(queue).length } }));
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }
  function formatTime(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not available";
  }
  function safeMessage(error, fallback = "Something went wrong.") {
    const text = String(error?.message || fallback).trim();
    return (text || fallback).slice(0, 300);
  }

  async function idToken(forceRefresh = false) {
    const immediate = forceRefresh ? "" : String(bridge()?.getCachedIdToken?.() || "");
    if (immediate) return immediate;
    if (!bridge()?.refreshIdToken?.()) throw new Error(tr("CloudAccount.Error.SignInRequired", "Please sign in to your WonderLang account and try again."));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(tr("CloudAccount.Error.SignInRequired", "Please sign in to your WonderLang account and try again."))), 15_000);
      tokenWaiters.push(token => {
        clearTimeout(timeout);
        token ? resolve(token) : reject(new Error(tr("CloudAccount.Error.SignInRequired", "Please sign in to your WonderLang account and try again.")));
      });
    });
  }

  async function cloudFetch(url, options) {
    try {
      const response = await fetch(url, options);
      if (!deviceOffline()) noteOnline();
      return response;
    } catch (error) {
      noteConnectionFailure();
      const translated = new Error(tr("CloudAccount.Error.ConnectionFailed", "Could not connect to WonderLang. Check your internet connection and try again."));
      translated.cause = error;
      throw translated;
    }
  }

  async function request(path, options = {}) {
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const send = token => {
      const appCheckToken = String(bridge()?.getCachedAppCheckToken?.() || "");
      return cloudFetch(`${apiBase}${path}`, {
        method: options.method || "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {})
        },
        ...(body ? { body } : {})
      });
    };
    let response;
    response = await send(await idToken());
    if (response.status === 401) response = await send(await idToken(true));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new AccountApiError(response.status, result.error || `Account request failed (${response.status}).`);
    return result;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function ownsProduct(sku) {
    const normalized = String(sku || "").trim().toLowerCase();
    if (!knownMobileSkus.has(normalized)) return false;
    const value = effectiveCachedEntitlement();
    if (!value) return false;
    if (value.fullGame) return true;
    const chapter = /^wonderlangch([1-4])$/.exec(normalized);
    return chapter ? (value.chapters || []).includes(Number(chapter[1])) : false;
  }

  async function refresh() {
    const me = await request("/api/v1/me");
    cache(me);
    window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: me.entitlements }));
    if (effectiveCachedEntitlement()?.cloudSave && activeProfileId()) scheduleStartupProfileCheck(750);
    return me.entitlements;
  }

  async function drainUploadQueue() {
    if (document.hidden || drainingRetries || startupProfileDecisionPending || isOffline() || !effectiveCachedEntitlement()?.cloudSave) return;
    drainingRetries = true;
    try {
      const queue = retryQueue();
      for (const item of Object.values(queue)) {
        if (Date.parse(item.notBefore || "") > Date.now()) continue;
        if (!item.profileId || item.profileId !== activeProfileId()) continue;
        try {
          const result = await uploadProfile(item.profileId);
          if (result?.conflict) break;
        } catch (error) {
          queueProfileUpload(item.profileId, error);
        }
      }
    } finally {
      drainingRetries = false;
    }
  }

  function queueProfileUpload(profileId, error) {
    if (!profileId) return;
    const queue = retryQueue();
    const previous = queue[profileId] || {};
    const attemptCount = Number(previous.attemptCount || 0) + 1;
    const delayMs = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.min(attemptCount - 1, 9)));
    queue[profileId] = {
      profileId,
      queuedAt: previous.queuedAt || new Date().toISOString(),
      attemptCount,
      notBefore: new Date(Date.now() + delayMs).toISOString(),
      changeToken: previous.changeToken || `${Date.now()}-${Math.random()}`,
      lastError: safeMessage(error)
    };
    saveRetryQueue(queue);
  }

  function markProfileDirty(profileId) {
    if (!profileId) return;
    const queue = retryQueue();
    const previous = queue[profileId] || {};
    queue[profileId] = {
      profileId,
      queuedAt: previous.queuedAt || new Date().toISOString(),
      attemptCount: Number(previous.attemptCount || 0),
      notBefore: new Date(Date.now() + 1500).toISOString(),
      changeToken: `${Date.now()}-${Math.random()}`,
      ...(previous.lastError ? { lastError: previous.lastError } : {})
    };
    saveRetryQueue(queue);
  }

  function clearQueuedProfile(profileId) {
    const queue = retryQueue();
    delete queue[profileId];
    saveRetryQueue(queue);
  }

  function managedSaveNames() {
    const maximum = Math.min(20, Math.max(1, Number(DataManager.maxSavefiles?.()) || 20));
    return ["global", ...Array.from({ length: maximum + 1 }, (_, index) => `file${index}`)];
  }

  function hasLocalPlayerSaves() {
    return managedSaveNames().some(name => name !== "global" && StorageManager.exists(name));
  }

  async function objectJson(saveName) {
    const object = saveName === "global" && !StorageManager.exists("global")
      ? (DataManager._globalInfo || [])
      : await StorageManager.loadObject(saveName);
    return StorageManager.objectToJson(object);
  }

  function profileGlobalInfo(value, hasSaves) {
    // Older exports can contain a wrapper or an indexed object. Keep slot IDs;
    // Object.values() would shift sparse slots and attach the wrong save labels.
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.globalInfo)) return value.globalInfo;
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length && keys.every(key => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 10000)) {
        const result = [];
        for (const key of keys) result[Number(key)] = value[key];
        return result;
      }
      if (!keys.length && !hasSaves) return [];
    }
    if (value == null && !hasSaves) return [];
    // Reject before touching local progress instead of installing an unusable index.
    throw new Error(tr("CloudAccount.Error.InvalidCloudCopy", "The cloud save could not be verified. No local saves were replaced."));
  }

  async function buildProfileBundle(profileId, attempt = 0) {
    await Promise.all([...pendingSaveWrites]);
    const generation = saveWriteGeneration;
    const files = {};
    for (const saveName of managedSaveNames()) {
      if (saveName !== "global" && !StorageManager.exists(saveName)) continue;
      files[saveName] = await objectJson(saveName);
    }
    if (!files.global) files.global = await StorageManager.objectToJson(DataManager._globalInfo || []);
    if (pendingSaveWrites.size || generation !== saveWriteGeneration) {
      if (attempt >= 3) throw new Error(tr("CloudAccount.Error.SaveBusy", "The game is still saving. Please try syncing again in a moment."));
      return buildProfileBundle(profileId, attempt + 1);
    }
    return {
      magic: "WL_CLOUD_PROFILE",
      version: 1,
      profileId,
      exportedAt: new Date().toISOString(),
      files
    };
  }

  async function profileFilesFingerprint(files) {
    const ordered = {};
    for (const name of managedSaveNames()) {
      if (typeof files?.[name] === "string") ordered[name] = files[name];
    }
    return sha256Hex(textEncoder.encode(JSON.stringify(ordered)));
  }

  function validateProfileBundle(bundle, profileId) {
    if (!bundle || bundle.magic !== "WL_CLOUD_PROFILE" || bundle.version !== 1 || bundle.profileId !== profileId ||
        !bundle.files || typeof bundle.files.global !== "string") {
      throw new Error(tr("CloudAccount.Error.InvalidCloudCopy", "The cloud save could not be verified. No local saves were replaced."));
    }
    const allowed = /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/;
    if (Object.keys(bundle.files).some(name => !allowed.test(name) || typeof bundle.files[name] !== "string")) {
      throw new Error(tr("CloudAccount.Error.InvalidCloudCopy", "The cloud save could not be verified. No local saves were replaced."));
    }
  }

  async function applyProfileBundle(bundle, profileId) {
    validateProfileBundle(bundle, profileId);
    // Decode the entire incoming set before touching any existing save.
    const decoded = {};
    for (const [name, json] of Object.entries(bundle.files)) {
      decoded[name] = await StorageManager.jsonToObject(json);
    }
    decoded.global = profileGlobalInfo(decoded.global, Object.keys(decoded).some(name => name !== "global"));
    const previousBinding = workspaceBinding();
    const previousBundle = await buildProfileBundle(previousBinding?.profileId || "unlabelled");
    const previousGlobalInfo = DataManager._globalInfo;
    // Keep displaced local files outside the synchronized slot names. Never
    // relabel an unknown/different account's files as the requested profile.
    const recoveryName = `wl-profile-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await StorageManager.saveObject(recoveryName, { binding: previousBinding, bundle: previousBundle });
    applyingProfile = true;
    try {
      for (const saveName of managedSaveNames()) {
        if (StorageManager.exists(saveName)) await Promise.resolve(StorageManager.remove(saveName));
      }
      for (const [saveName, object] of Object.entries(decoded)) {
        await StorageManager.saveObject(saveName, object);
      }
      // Use the already validated index. Never pass a null/wrapped storage result
      // to the engine's removeInvalidGlobalInfo (which iterates an array).
      DataManager._globalInfo = decoded.global;
      DataManager.removeInvalidGlobalInfo?.();
    } catch (error) {
      for (const saveName of managedSaveNames()) {
        if (StorageManager.exists(saveName)) await Promise.resolve(StorageManager.remove(saveName));
      }
      for (const [name, json] of Object.entries(previousBundle.files)) {
        await StorageManager.saveObject(name, await StorageManager.jsonToObject(json));
      }
      DataManager._globalInfo = previousGlobalInfo;
      throw error;
    } finally {
      applyingProfile = false;
    }
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-applied", { detail: { profileId } }));
  }

  async function listProfiles() {
    return (await request("/api/v1/cloud-save-profiles")).profiles || [];
  }

  function serializeProfileOperation(action) {
    const next = profileOperationTail.catch(() => undefined).then(action);
    profileOperationTail = next;
    return next;
  }

  function uploadProfile(profileId, options = {}) {
    const uid = accountUid();
    return serializeProfileOperation(async () => {
      if (uid !== accountUid()) return { skipped: "account_changed" };
      if (conflictProfileId === profileId && !Object.prototype.hasOwnProperty.call(options, "baseRevision")) return { conflict: true };
      try { return await performProfileUpload(profileId, options); }
      catch (error) {
        if (error?.status === 409 && options.showConflict !== false) {
          const resolved = await presentProfileConflict(profileId);
          return resolved || { conflict: true };
        }
        throw error;
      }
    });
  }

  async function performProfileUpload(profileId, options = {}) {
    if (!effectiveCachedEntitlement()?.cloudSave) return { skipped: "not_entitled" };
    if (!profileId || profileId !== activeProfileId()) return { skipped: "not_active" };
    if (!workspaceMatches(profileId)) throw new Error(tr("CloudAccount.Error.WorkspaceMismatch", "These local saves are not verified as belonging to the selected profile."));
    const queuedChangeToken = retryQueue()[profileId]?.changeToken || null;
    const bundle = await buildProfileBundle(profileId);
    const fingerprint = await profileFilesFingerprint(bundle.files);
    const binding = workspaceBinding();
    // Metadata writes and retry timers can mark an unchanged profile dirty.
    // Do not create another cloud revision for identical saved content.
    if (!Object.prototype.hasOwnProperty.call(options, "baseRevision") && binding?.revision && binding.fingerprint === fingerprint) {
      if ((retryQueue()[profileId]?.changeToken || null) === queuedChangeToken) {
        clearQueuedProfile(profileId);
        saveWorkspaceBinding(profileId, { localChangedAt: null });
      }
      return { unchanged: true, currentRevision: binding.revision };
    }
    const bytes = textEncoder.encode(JSON.stringify(bundle));
    const baseRevision = Object.prototype.hasOwnProperty.call(options, "baseRevision")
      ? options.baseRevision
      : (binding?.revision || revisions()[profileId] || null);
    const prepare = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/prepare-upload`, {
      method: "POST",
      body: {
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        baseRevision
      }
    });
    const upload = await cloudFetch(prepare.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: bytes
    });
    if (!upload.ok) throw new Error(tr("CloudAccount.Error.UploadFailed", "Could not upload the saves (error {STATUS}). Please try again.", { STATUS: upload.status }));
    try {
      const manifest = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/finalize`, {
        method: "POST",
        body: { uploadId: prepare.uploadId }
      });
      setRevision(profileId, manifest.currentRevision);
      const latestChangeToken = retryQueue()[profileId]?.changeToken || null;
      const settled = latestChangeToken === queuedChangeToken;
      saveWorkspaceBinding(profileId, {
        revision: manifest.currentRevision,
        fingerprint,
        cloudUpdatedAt: manifest.updatedAt,
        ...(settled ? { localChangedAt: null } : {})
      });
      if (settled) clearQueuedProfile(profileId);
      window.dispatchEvent(new CustomEvent("wl-cloud-profile-synced", { detail: { profileId, manifest } }));
      return manifest;
    } catch (error) {
      if (error?.status === 409 && options.showConflict !== false) {
        const resolved = await presentProfileConflict(profileId);
        return resolved || { conflict: true };
      }
      throw error;
    }
  }

  async function downloadProfile(profileId) {
    const remote = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/download`);
    const response = await cloudFetch(remote.downloadUrl);
    if (!response.ok) throw new Error(tr("CloudAccount.Error.DownloadFailed", "Could not download the saves (error {STATUS}). Please try again.", { STATUS: response.status }));
    let bytes;
    const reader = response.body?.getReader?.();
    if (reader) {
      const chunks = []; let received = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value); received += part.value.byteLength;
        if (received > remote.manifest.byteLength) { await reader.cancel(); throw new Error(tr("CloudAccount.Error.InvalidCloudCopy", "The cloud save could not be verified. No local saves were replaced.")); }
        updateDownloadProgress(received, remote.manifest.byteLength);
      }
      bytes = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    updateDownloadProgress(bytes.byteLength, bytes.byteLength);
    if (bytes.byteLength !== remote.manifest.byteLength || await sha256Hex(bytes) !== remote.manifest.sha256) {
      throw new Error(tr("CloudAccount.Error.InvalidCloudCopy", "The cloud save could not be verified. No local saves were replaced."));
    }
    const bundle = JSON.parse(textDecoder.decode(bytes));
    validateProfileBundle(bundle, profileId);
    return { remote, bundle };
  }

  function restoreProfile(profileId) {
    const uid = accountUid();
    return serializeProfileOperation(() => {
      if (uid !== accountUid()) throw new Error(tr("CloudAccount.Error.ContextChanged", "The account or save profile has changed. Please select your profile and try again."));
      return performProfileRestore(profileId);
    });
  }

  async function performProfileRestore(profileId) {
    const { remote, bundle } = await downloadProfile(profileId);
    await applyProfileBundle(bundle, profileId);
    setRevision(profileId, remote.manifest.currentRevision);
    saveWorkspaceBinding(profileId, {
      revision: remote.manifest.currentRevision,
      fingerprint: await profileFilesFingerprint((await buildProfileBundle(profileId)).files),
      cloudUpdatedAt: remote.manifest.updatedAt,
      localChangedAt: null
    });
    clearQueuedProfile(profileId);
    failedStartupWorkspace = "";
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-restored", { detail: { profileId, manifest: remote.manifest } }));
    return remote.manifest;
  }

  function downloadPanel(profile) {
    showPanel(tr("CloudAccount.Startup.DownloadingTitle", "Loading cloud saves"), `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.Download.Body", "Downloading {PROFILE}'s profile save files…", { PROFILE: profile.name }))}</p><progress data-cloud-download max="100" style="width:100%;height:18px;accent-color:#ffcf40;margin-top:20px"></progress><p class="wl-account-muted" data-cloud-download-label aria-live="polite"></p>`);
  }
  function updateDownloadProgress(received, total) {
    const progress = activeOverlay?.querySelector("[data-cloud-download]");
    if (!progress || !total) return;
    const percent = Math.min(100, Math.floor(received / total * 100));
    progress.value = percent;
    const label = activeOverlay.querySelector("[data-cloud-download-label]");
    if (label) label.textContent = percent < 100 ? `${percent}%` : tr("CloudAccount.Download.Finishing", "Download complete. Checking and loading saves…");
  }

  function scheduleProfileSync() {
    if (applyingProfile || !activeProfileId() || accountUid() === "signed-out" || !workspaceMatches(activeProfileId())) return;
    noteWorkspaceChanged(activeProfileId());
    markProfileDirty(activeProfileId());
    clearTimeout(profileSyncTimer);
    profileSyncTimer = setTimeout(() => {
      const profileId = activeProfileId();
      if (startupProfileDecisionPending || isOffline()) { if (isOffline()) noteOffline(); return; }
      profileSyncInFlight = Promise.resolve(profileSyncInFlight).catch(() => undefined).then(() => uploadProfile(profileId));
      profileSyncInFlight.catch(error => {
        if (deviceOffline()) noteOffline();
        console.warn("[WonderLang Cloud Save] Local save succeeded; complete profile upload did not.", error);
        queueProfileUpload(profileId, error);
        window.dispatchEvent(new CustomEvent("wl-cloud-save-error", { detail: { profileId, message: safeMessage(error) } }));
      });
    }, 1500);
  }

  async function syncActiveProfileNow() {
    const profileId = activeProfileId();
    if (!profileId) throw new Error(tr("CloudAccount.Status.Chooseaprofile", "Choose a profile"));
    clearTimeout(profileSyncTimer);
    if (profileSyncInFlight) await profileSyncInFlight.catch(() => undefined);
    return uploadProfile(profileId);
  }

  function syncFromUi() {
    if (manualSyncInFlight) return manualSyncInFlight;
    manualSyncInFlight = (async () => {
      if (accountUid() === "signed-out") return showSignInIntro();
      if (deviceOffline()) {
        noteOffline();
        return showPanel(tr("CloudAccount.Offline.Title", "Offline — sync paused"), "<p class='wl-account-muted'>" + escapeHtml(offlineMessage()) + "</p>", [{ label: "Continue", run: closeOverlay }]);
      }
      if (!effectiveCachedEntitlement()?.cloudSave) return openAccountPanel();
      const profileId = activeProfileId();
      if (!profileId || !workspaceMatches(profileId)) return openCloudSavesPanel(true);
      try {
        showPanel(tr("CloudAccount.Startup.SyncingTitle", "Syncing newer saves"), `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.Startup.SyncingBody", "Uploading {PROFILE}'s saves to the cloud…", { PROFILE: workspaceBinding()?.profileName || profileId }))}</p>`);
        if (profileSyncInFlight) await profileSyncInFlight.catch(() => undefined);
        const profile = (await listProfiles()).find(item => item.profileId === profileId);
        if (!profile) return openCloudSavesPanel(true);
        if (profile.currentRevision && profile.currentRevision !== workspaceBinding()?.revision) {
          return presentProfileConflict(profileId);
        }
        conflictProfileId = "";
        startupProfileDecisionPending = false;
        const result = await syncActiveProfileNow();
        if (result?.conflict) return;
        if (result?.skipped) return openAccountPanel();
        finishStartupProfileDecision();
        showPanel(tr("CloudAccount.Startup.SyncedTitle", "Cloud backup updated"), `<p class="wl-account-success">${escapeHtml(tr("CloudAccount.Startup.SyncedBody", "The latest local saves for {PROFILE} are safely stored in the WonderLang cloud.", { PROFILE: profile.name }))}</p>`, [
          { label: "Continue", run: closeOverlay }
        ]);
      } catch (error) {
        queueProfileUpload(profileId, error);
        showError(tr("CloudAccount.Error.UploadTitle", "Newer saves were not uploaded"), error, syncFromUi);
      }
    })().finally(() => { manualSyncInFlight = null; });
    return manualSyncInFlight;
  }

  function accountTheme() {
    let theme = {};
    try {
      theme = globalThis.ColorThemeUtils?.computeThemeFromConfig?.() || {};
    } catch (_) {}
    const buttonGradient = String(theme.buttonGradient || "linear-gradient(135deg, #d9ff45 0%, #77df66 48%, #32b6a8 100%)");
    const gradientColor = buttonGradient.match(/(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba?\([^)]+\))/i)?.[1];
    let fontFamily = "NotoSans";
    try {
      const fonts = globalThis.TextManager?.optionsCoreFonts || [];
      const configured = String(fonts[Number(globalThis.ConfigManager?.textFont)] || "").trim();
      if (configured && !/^(?:default|gamefont)$/i.test(configured)) fontFamily = configured;
    } catch (_) {}
    return {
      panel: String(theme.primaryBg || "rgba(9, 24, 24, .96)"),
      panelAlt: String(theme.secondaryBg || "rgba(28, 62, 51, .96)"),
      gradient: buttonGradient,
      text: "#ffffff",
      highlight: "#ffffff",
      fontFamily
    };
  }

  function applyAccountTheme(overlay) {
    const theme = accountTheme();
    overlay.style.setProperty("--wl-account-panel", theme.panel);
    overlay.style.setProperty("--wl-account-panel-alt", theme.panelAlt);
    overlay.style.setProperty("--wl-account-gradient", theme.gradient);
    overlay.style.setProperty("--wl-account-text", theme.text);
    overlay.style.setProperty("--wl-account-highlight", theme.highlight);
    overlay.style.setProperty("--wl-account-font", `'${theme.fontFamily.replace(/'/g, "\\'")}'`);
  }

  function ensureStyles() {
    if (document.getElementById("wl-account-styles")) return;
    const style = document.createElement("style");
    style.id = "wl-account-styles";
    style.textContent = `
      html.wl-account-ui-open #titleListUI .panel{opacity:0!important;pointer-events:none!important;transform:translateY(-50%) translateX(2rem) scale(.97)!important}
      .wl-account-overlay,.wl-account-overlay *{box-sizing:border-box;font-family:var(--wl-account-font,'NotoSans'),sans-serif!important;-webkit-text-stroke:0!important}
      .wl-account-overlay{position:fixed;inset:0;z-index:1000001;display:grid;place-items:center;padding:clamp(14px,3.5vh,42px) clamp(14px,3.5vw,54px);color:var(--wl-account-text,#f8fff4);background:radial-gradient(circle at 18% 12%,rgba(191,255,87,.14),transparent 34%),radial-gradient(circle at 84% 88%,rgba(50,182,168,.14),transparent 32%),rgba(2,10,12,.72);backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15);animation:wl-account-backdrop-in .2s ease-out both}
      .wl-account-panel{position:relative;isolation:isolate;width:min(1040px,94vw);max-height:min(900px,92vh);display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid rgba(255,255,255,.2);border-radius:clamp(18px,2.2vw,30px);background:linear-gradient(145deg,var(--wl-account-panel,rgba(9,24,24,.96)),var(--wl-account-panel-alt,rgba(28,62,51,.96)));box-shadow:0 2rem 6rem rgba(0,0,0,.56),inset 0 1px rgba(255,255,255,.12);animation:wl-account-panel-in .26s cubic-bezier(.2,.8,.2,1) both}
      .wl-account-panel::before{content:"";position:absolute;z-index:2;inset:0 0 auto;height:4px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8))}
      .wl-account-panel::after{content:"";position:absolute;z-index:-1;width:360px;height:360px;right:-150px;top:-180px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);filter:blur(90px);opacity:.12;pointer-events:none}
      .wl-account-header{display:flex;align-items:center;gap:16px;padding:clamp(20px,3vw,34px) clamp(20px,3.6vw,42px) 18px;border-bottom:1px solid rgba(255,255,255,.1)}
      .wl-account-mark{width:52px;height:52px;display:grid;place-items:center;flex:0 0 auto;border-radius:16px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8));color:#102015;font-size:30px;font-weight:950;line-height:1;transform:rotate(-3deg);box-shadow:0 10px 24px rgba(0,0,0,.25),inset 0 1px rgba(255,255,255,.45)}
      .wl-account-heading{min-width:0}.wl-account-kicker{margin-bottom:4px;color:var(--wl-account-highlight,#d9ff45);font-size:11px;font-weight:900;letter-spacing:.22em;text-transform:uppercase}.wl-account-panel h2{margin:0;color:var(--wl-account-text,#fff);font-size:clamp(25px,3.5vw,38px);font-weight:900;line-height:1.05;letter-spacing:-.025em}.wl-account-trust{margin-left:auto;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(0,0,0,.18);color:rgba(255,255,255,.76);font-size:12px;font-weight:750;white-space:nowrap}.wl-account-trust-dot{width:8px;height:8px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 12px var(--wl-account-highlight,#d9ff45)}
      .wl-account-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--wl-account-highlight,#d9ff45) rgba(0,0,0,.18);touch-action:pan-y;-webkit-overflow-scrolling:touch}.wl-account-scroll::-webkit-scrollbar{width:8px}.wl-account-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:var(--wl-account-highlight,#d9ff45)}.wl-account-content{padding:clamp(20px,3vw,36px) clamp(20px,3.6vw,42px)}
      .wl-account-panel h3{margin:0;color:var(--wl-account-text,#fff);font-size:clamp(18px,2.2vw,23px);font-weight:850;line-height:1.2}.wl-account-muted{margin:0;color:rgba(238,248,241,.7);font-size:clamp(14px,1.7vw,17px);line-height:1.58}.wl-account-muted+.wl-account-muted{margin-top:10px}
      .wl-account-identity-row{display:flex;align-items:stretch;flex-wrap:wrap;gap:10px;margin-bottom:20px}.wl-account-identity{display:flex;align-items:center;gap:12px;min-height:46px;max-width:100%;padding:10px 14px;border:1px solid rgba(255,255,255,.13);border-radius:14px;background:rgba(0,0,0,.16);color:rgba(255,255,255,.92);font-size:15px;font-weight:720}.wl-account-identity::before{content:"";width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 13px var(--wl-account-highlight,#d9ff45)}.wl-account-profile-switcher{position:relative;min-height:46px;display:flex;align-items:center;gap:9px;padding:5px 38px 5px 13px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.68);cursor:pointer}.wl-account-profile-switcher::after{content:"⌄";position:absolute;right:14px;top:50%;color:var(--wl-account-highlight,#d9ff45);font-size:20px;font-weight:900;line-height:1;transform:translateY(-58%);pointer-events:none}.wl-account-profile-label{font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.wl-account-profile-select{min-width:110px;max-width:230px;border:0;outline:0;appearance:none;-webkit-appearance:none;background:transparent;color:var(--wl-account-text,#fff);font-size:15px;font-weight:850;cursor:pointer}.wl-account-profile-select option{background:#13251f;color:#fff}.wl-account-profile-switcher:focus-within{border-color:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 0 3px rgba(217,255,69,.14)}
      .wl-account-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:22px 0}.wl-account-card{position:relative;min-height:106px;padding:18px 18px 16px;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:17px;background:linear-gradient(145deg,rgba(255,255,255,.105),rgba(0,0,0,.14));box-shadow:inset 0 1px rgba(255,255,255,.06)}.wl-account-card::after{content:"";position:absolute;width:74px;height:74px;right:-34px;bottom:-38px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);filter:blur(28px);opacity:.12}.wl-account-card b{display:block;margin-bottom:10px;color:var(--wl-account-highlight,#d9ff45);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.wl-account-card{font-size:16px;font-weight:760;line-height:1.35}
      .wl-account-actions{display:flex;flex-wrap:wrap;gap:10px;padding:16px clamp(20px,3.6vw,42px) clamp(20px,3vw,30px);border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.12)}.wl-account-actions:empty{display:none}.wl-account-btn{min-height:48px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:11px 18px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8));box-shadow:0 8px 22px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.4);color:#112016;font-size:15px;font-weight:900;letter-spacing:.01em;cursor:pointer;touch-action:manipulation;transition:transform .12s ease,filter .12s ease,box-shadow .12s ease}.wl-account-btn:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 11px 28px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.45)}.wl-account-btn:active{transform:scale(.97)}.wl-account-btn:focus-visible{outline:3px solid var(--wl-account-highlight,#d9ff45);outline-offset:3px}.wl-account-btn:disabled{cursor:not-allowed;opacity:.45;filter:saturate(.4);transform:none}.wl-account-btn.secondary{background:rgba(255,255,255,.08);box-shadow:inset 0 1px rgba(255,255,255,.08);color:var(--wl-account-text,#fff)}.wl-account-btn.danger{border-color:rgba(255,174,185,.32);background:linear-gradient(135deg,#ff9c91,#d95b70);color:#2b0a11}
      .wl-account-input{display:block;width:100%;margin:18px 0 2px;padding:16px 17px;border:1px solid rgba(255,255,255,.2);border-radius:15px;outline:0;background:rgba(0,0,0,.22);box-shadow:inset 0 2px 8px rgba(0,0,0,.18);color:#fff;font-size:18px;font-weight:680;transition:border-color .15s ease,box-shadow .15s ease}.wl-account-input:focus{border-color:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 0 3px rgba(217,255,69,.14),inset 0 2px 8px rgba(0,0,0,.18)}
      .wl-account-code{display:inline-block;margin:16px 0;padding:15px 19px;border:1px solid rgba(255,255,255,.2);border-radius:15px;background:rgba(0,0,0,.24);color:#fff;font:800 28px/1.1 monospace;letter-spacing:.14em}
      .wl-account-save{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;margin-top:12px;padding:17px 18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(0,0,0,.13);transition:border-color .14s ease,background .14s ease,transform .14s ease}.wl-account-save:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.07)}.wl-account-save.active{border-color:var(--wl-account-highlight,#d9ff45);background:linear-gradient(120deg,rgba(255,255,255,.12),rgba(0,0,0,.12));box-shadow:0 0 0 1px var(--wl-account-highlight,#d9ff45),0 12px 30px rgba(0,0,0,.18)}.wl-account-save h3{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-bottom:7px}.wl-account-active-pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:var(--wl-account-highlight,#d9ff45);color:#142116;font-size:10px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.wl-account-save-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.wl-account-save-actions .wl-account-btn{min-height:42px;padding:9px 13px;font-size:13px}
      .wl-account-error,.wl-account-success{position:relative;margin:0;padding:16px 18px 16px 48px;border-radius:16px;font-size:15px;font-weight:680;line-height:1.5}.wl-account-error::before,.wl-account-success::before{position:absolute;left:18px;top:16px;width:20px;height:20px;display:grid;place-items:center;border-radius:50%;font-size:13px;font-weight:950}.wl-account-error{border:1px solid rgba(255,155,170,.42);background:rgba(112,29,45,.48);color:#ffe9ed}.wl-account-error::before{content:"!";background:#ff8d9c;color:#351016}.wl-account-success{border:1px solid rgba(191,255,87,.38);background:rgba(45,105,62,.42);color:#efffe6}.wl-account-success::before{content:"✓";background:var(--wl-account-highlight,#d9ff45);color:#142116}
      @keyframes wl-account-backdrop-in{from{opacity:0}to{opacity:1}}@keyframes wl-account-panel-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
      @media(max-width:700px){.wl-account-overlay{padding:10px}.wl-account-panel{width:100%;max-height:96vh;border-radius:22px}.wl-account-header{gap:12px;padding:18px 18px 15px}.wl-account-mark{width:44px;height:44px;border-radius:13px;font-size:25px}.wl-account-trust{display:none}.wl-account-content{padding:18px}.wl-account-status{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.wl-account-card{min-height:92px;padding:14px}.wl-account-save{grid-template-columns:1fr;padding:15px}.wl-account-save-actions{justify-content:stretch}.wl-account-save-actions .wl-account-btn{flex:1}.wl-account-actions{padding:14px 18px 18px}.wl-account-actions>.wl-account-btn{flex:1 1 145px}}
      @media(max-width:430px){.wl-account-status{grid-template-columns:1fr}.wl-account-header{align-items:flex-start}.wl-account-panel h2{font-size:24px}.wl-account-kicker{font-size:9px}.wl-account-identity,.wl-account-profile-switcher{width:100%}.wl-account-profile-select{max-width:none;flex:1}.wl-account-actions>.wl-account-btn{flex-basis:100%}}
      @media(max-height:620px){.wl-account-overlay{padding:8px}.wl-account-panel{max-height:97vh}.wl-account-header{padding-top:14px;padding-bottom:12px}.wl-account-mark{width:40px;height:40px;font-size:23px}.wl-account-content{padding-top:15px;padding-bottom:15px}.wl-account-actions{padding-top:11px;padding-bottom:12px}.wl-account-card{min-height:84px}}
      .wl-account-profile-picker{position:relative;z-index:5;flex:0 1 280px;min-width:0;max-width:100%}
      .wl-profile-trigger{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:12px 15px;border:1px solid rgba(255,255,255,.24);border-radius:15px;background:rgba(255,255,255,.08);color:#fff;font:inherit;cursor:pointer;touch-action:manipulation;text-align:start;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
      .wl-profile-trigger strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.wl-profile-trigger .wl-account-profile-label{color:rgba(255,255,255,.72);font-size:10px}.wl-profile-chevron{color:#ffcf40;font-size:22px;line-height:1;transition:transform .15s}.wl-profile-trigger[aria-expanded="true"]{border-color:#ffcf40;background:rgba(255,207,64,.09)}.wl-profile-trigger[aria-expanded="true"] .wl-profile-chevron{transform:rotate(180deg)}
      .wl-profile-options{position:absolute;inset-inline:0;top:calc(100% + 9px);padding:7px;max-height:min(340px,42vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid rgba(255,207,64,.4);border-radius:17px;background:#21132f;box-shadow:0 16px 38px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07);touch-action:pan-y}.wl-profile-options[hidden]{display:none}
      .wl-profile-option{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;margin:0;padding:11px 12px;border:1px solid transparent;border-radius:11px;background:transparent;color:#fff;text-align:start;font:inherit;cursor:pointer;touch-action:pan-y}.wl-profile-option+.wl-profile-option{margin-top:3px}.wl-profile-option:hover{background:rgba(255,255,255,.08)}.wl-profile-option[aria-checked="true"]{background:rgba(255,207,64,.12);border-color:rgba(255,207,64,.32)}
      .wl-profile-avatar{display:grid;place-items:center;flex:0 0 35px;height:35px;border-radius:10px;background:rgba(255,255,255,.09);color:#fff;font-size:17px;font-weight:850}.wl-profile-option[aria-checked="true"] .wl-profile-avatar{background:linear-gradient(135deg,#ffe25a,#ffa600);color:#22152a}.wl-profile-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.wl-profile-copy strong{font-size:15px;line-height:1.25;overflow-wrap:anywhere}.wl-profile-copy small{font-size:11px;color:rgba(255,255,255,.7)}.wl-profile-check{color:#ffdc62;font-size:20px;font-weight:900}.wl-profile-trigger:focus-visible,.wl-profile-option:focus-visible{outline:2px solid #ffe17b;outline-offset:2px}
      @media(max-width:600px){.wl-account-profile-picker{flex:1 1 100%}.wl-profile-options{max-height:35vh}.wl-profile-option{min-height:60px}}
      @media(prefers-reduced-motion:reduce){.wl-account-overlay,.wl-account-panel,.wl-account-btn,.wl-account-save,.wl-profile-chevron{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function closeOverlay() {
    activeOverlay?.remove();
    activeOverlay = null;
    document.documentElement.classList.remove("wl-account-ui-open");
    clearGameInputState();
  }

  function clearGameInputState() {
    if (globalThis.TouchInput?.clear) globalThis.TouchInput.clear();
    if (globalThis.Input?.clear) globalThis.Input.clear();
  }

  function blockGameInput(overlay) {
    const blockedEvents = [
      "pointerdown", "pointerup", "pointermove", "pointercancel",
      "mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu", "wheel",
      "touchstart", "touchmove", "touchend", "touchcancel",
      "keydown", "keyup", "keypress"
    ];
    for (const type of blockedEvents) {
      overlay.addEventListener(type, event => {
        event.stopPropagation();
        const canScroll = event.target?.closest?.(".wl-account-scroll");
        if (type === "contextmenu" || ((type === "wheel" || type === "touchmove") && !canScroll)) event.preventDefault();
      }, { passive: false });
    }
  }

  function bindReleaseTap(button, action) {
    let touch = null, pointer = null, lastTouchAt = 0, suppressClickUntil = 0, busy = false;
    const stop = event => { event.stopPropagation(); if (event.cancelable) event.preventDefault(); };
    const activate = event => {
      stop(event);
      if (button.disabled || busy) return;
      busy = true;
      suppressClickUntil = Date.now() + 750;
      let result;
      try { result = action(); } catch (error) { busy = false; throw error; }
      if (result && typeof result.then === "function") {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        Promise.resolve(result).catch(error => console.warn("[WonderLang Cloud Save] Action failed.", safeMessage(error))).finally(() => {
          busy = false; button.disabled = false; button.removeAttribute("aria-busy");
        });
      } else busy = false;
    };
    button.addEventListener("touchstart", event => {
      lastTouchAt = Date.now(); pointer = null;
      if (button.disabled || event.touches.length !== 1) { touch = null; return; }
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, moved: false };
      event.stopPropagation();
    }, { passive: true });
    button.addEventListener("touchmove", event => {
      if (event.touches.length !== 1) touch = null;
      if (touch) {
        const point = event.touches[0];
        if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 12) touch.moved = true;
      }
      event.stopPropagation();
    }, { passive: true });
    button.addEventListener("touchcancel", event => { touch = null; suppressClickUntil = Date.now() + 750; stop(event); }, { passive: false });
    button.addEventListener("touchend", event => {
      const point = event.changedTouches?.[0];
      const valid = touch && !touch.moved && point && Math.hypot(point.clientX-touch.x,point.clientY-touch.y) <= 12;
      touch = null; lastTouchAt = Date.now(); suppressClickUntil = Date.now() + 750;
      stop(event); if (valid) activate(event);
    }, { passive: false });
    // Some Android WebViews deliver pointer events without a synthetic click.
    button.addEventListener("pointerdown", event => {
      if (button.disabled || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.stopPropagation();
    });
    button.addEventListener("pointermove", event => {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12) pointer.moved=true;
      event.stopPropagation();
    });
    button.addEventListener("pointercancel", () => { pointer = null; });
    button.addEventListener("pointerup", event => {
      const valid = pointer?.id === event.pointerId && !pointer.moved && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<=12;
      pointer = null;
      event.stopPropagation();
      if (event.pointerType === "touch" && Date.now()-lastTouchAt < 900) return;
      suppressClickUntil = Date.now() + 750;
      if (valid) activate(event);
    }, { passive: false });
    button.addEventListener("click", event => {
      stop(event);
      if (Date.now() >= suppressClickUntil) activate(event);
    });
  }

  function showPanel(title, bodyHtml, actions = []) {
    ensureStyles();
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "wl-account-overlay";
    blockGameInput(overlay);
    clearGameInputState();
    applyAccountTheme(overlay);
    const localizedTitle = trSource(title);
    overlay.innerHTML = `<section class="wl-account-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(localizedTitle)}">
      <header class="wl-account-header"><div class="wl-account-mark" aria-hidden="true">W</div><div class="wl-account-heading"><div class="wl-account-kicker">${escapeHtml(trSource("WonderLang Cloud"))}</div><h2>${escapeHtml(localizedTitle)}</h2></div><div class="wl-account-trust"><span class="wl-account-trust-dot"></span>${escapeHtml(trSource("Secure sync"))}</div></header>
      <div class="wl-account-scroll"><div class="wl-account-content">${bodyHtml}</div></div><div class="wl-account-actions"></div>
    </section>`;
    translateStaticTextNodes(overlay.querySelector(".wl-account-content"));
    const actionsHost = overlay.querySelector(".wl-account-actions");
    actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `wl-account-btn ${action.kind || ""}`.trim();
      button.textContent = trSource(action.label);
      bindReleaseTap(button, () => action.run?.());
      actionsHost.appendChild(button);
    });
    document.documentElement.classList.add("wl-account-ui-open");
    document.body.appendChild(overlay);
    activeOverlay = overlay;
    return overlay;
  }

  function playerErrorMessage(error) {
    if (error instanceof AccountApiError) {
      return error.status === 401
        ? tr("CloudAccount.Error.SignInRequired", "Please sign in to your WonderLang account and try again.")
        : tr("CloudAccount.Error.RequestFailed", "WonderLang could not complete the request. Please try again.");
    }
    return safeMessage(error);
  }

  function showError(title, error, retry) {
    console.warn("[WonderLang Account]", title, error);
    showPanel(title, `<p class="wl-account-error">${escapeHtml(playerErrorMessage(error))}</p>`, [
      ...(retry ? [{ label: "Try again", run: retry }] : []),
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
  }

  function beginSignIn() {
    try {
      const manager = bridge();
      if (!manager?.openSignIn || manager.openSignIn() !== true) {
        throw new Error("Account sign-in is not available in this build yet.");
      }
      return true;
    } catch (error) {
      showError("Sign-in unavailable", error, beginSignIn);
      return false;
    }
  }

  function showDeviceSignInState(detail) {
    const state = String(detail?.state || "");
    if (state === "starting") {
      showPanel("Sign in to WonderLang", `<p class="wl-account-muted">Opening sign-in in your browser…</p>`, [
        { label: "Cancel", kind: "secondary", run: () => bridge()?.cancelSignIn?.() }
      ]);
      return;
    }
    if (state === "pending" || state === "checking") {
      showPanel("Sign in to WonderLang", `
        ${state === "checking" ? `<p class="wl-account-success" role="status">${escapeHtml(tr("CloudAccount.SignIn.Checking", "Checking sign-in status…"))}</p>` : ""}
        <p class="wl-account-muted">Use Google, Apple, or an email link to sign in through your browser. Then return to WonderLang; the game will finish signing you in automatically.</p>
        <p class="wl-account-muted">${escapeHtml(trSource("Please finish signing in before {TIME}.", { TIME: formatTime(detail.expiresAt) }))}</p>`, [
        { label: "Open sign-in page", run: () => bridge()?.reopenSignIn?.() },
        { label: tr("CloudAccount.SignIn.Check", "Check login status"), kind: "secondary", run: () => bridge()?.checkSignInStatus?.() },
        { label: "Cancel", kind: "secondary", run: () => bridge()?.cancelSignIn?.() },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      return;
    }
    if (state === "authorized") {
      const signedInOverlay = showPanel("Signed in", `<p class="wl-account-success">You are signed in. Loading your account and saves…</p>`, [
        { label: "Continue", run: openAccountPanel },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      setTimeout(() => { if (activeOverlay === signedInOverlay) openAccountPanel(); }, 900);
      return;
    }
    if (state === "error") {
      showError("PC/Mac sign-in failed", new Error(detail.message || "Device sign-in failed."), beginSignIn);
      return;
    }
    if (state === "cancelled") closeOverlay();
  }

  function renderProfilePicker(profiles, selectedId) {
    const selected = profiles.find(profile => profile.profileId === selectedId);
    if (!selected) return "";
    const rows = profiles.map(profile => {
      const active = profile.profileId === selectedId;
      return `<button type="button" class="wl-profile-option" role="menuitemradio" aria-checked="${active}" data-profile-choice="${escapeHtml(profile.profileId)}"><span class="wl-profile-avatar" aria-hidden="true">${escapeHtml(Array.from(profile.name || "?")[0].toUpperCase())}</span><span class="wl-profile-copy"><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(trSource(active ? "Selected" : "Use profile"))}</small></span><span class="wl-profile-check" aria-hidden="true">${active ? "✓" : "›"}</span></button>`;
    }).join("");
    return `<div class="wl-account-profile-picker"><button type="button" class="wl-profile-trigger" data-profile-switcher aria-haspopup="menu" aria-expanded="false" aria-controls="wl-profile-options" aria-label="${escapeHtml(trSource("Active save profile"))}: ${escapeHtml(selected.name)}"><span class="wl-account-profile-label">${escapeHtml(trSource("Profile"))}</span><strong>${escapeHtml(selected.name)}</strong><span class="wl-profile-chevron" aria-hidden="true">⌄</span></button><div class="wl-profile-options" id="wl-profile-options" role="menu" aria-label="${escapeHtml(trSource("Active save profile"))}" hidden>${rows}</div></div>`;
  }

  function bindProfilePicker(overlay, profiles) {
    const picker = overlay.querySelector(".wl-account-profile-picker");
    if (!picker) return;
    const trigger = picker.querySelector("[data-profile-switcher]");
    const menu = picker.querySelector(".wl-profile-options");
    const options = Array.from(menu.querySelectorAll("[data-profile-choice]"));
    const close = (focus = false) => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    };
    const open = () => {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      (options.find(button => button.getAttribute("aria-checked") === "true") || options[0])?.focus();
    };
    bindReleaseTap(trigger, () => menu.hidden ? open() : close(true));
    options.forEach(button => bindReleaseTap(button, () => {
      const profile = profiles.find(item => item.profileId === button.dataset.profileChoice);
      close(true);
      if (profile && profile.profileId !== activeProfileId()) {
        selectProfile(profile, { profiles, onCancel: openAccountPanel });
      }
    }));
    picker.addEventListener("keydown", event => {
      if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault(); event.stopPropagation(); close(true); return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (menu.hidden) { open(); return; }
      const index = options.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
        (index + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
      options[next]?.focus();
    });
    picker.addEventListener("focusout", event => {
      if (event.relatedTarget && !picker.contains(event.relatedTarget)) close();
    });
    // Overlay-scoped listeners disappear with the panel; no document leaks.
    overlay.addEventListener("pointerdown", event => {
      if (!picker.contains(event.target)) close();
    }, true);
    overlay.addEventListener("touchstart", event => {
      if (!picker.contains(event.target)) close();
    }, { capture: true, passive: true });
  }

  function showSignInIntro() {
    showPanel("WonderLang account", `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.Intro.Body", "Cloud saves are exclusive to Premium Lifetime Pass holders. Sync your progress between PC, Mac and mobile. Learn more at wonderlang.net."))}</p>`, [
      { label: "Sign in", run: beginSignIn },
      { label: "wonderlang.net", kind: "secondary", run: () => bridge()?.openExternalUrl?.("https://wonderlang.net/") },
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
  }
  function confirmSignOut() {
    showPanel(tr("CloudAccount.SignOut.Label", "Sign out"), `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.SignOut.Body", "Sign out on this device? Local saves will stay here. Any pending saves will sync only after you sign back in to this same account. Other devices will stay signed in."))}</p>`, [
      { label: tr("CloudAccount.SignOut.Label", "Sign out"), kind: "danger", run: async () => {
        clearTimeout(profileSyncTimer); clearTimeout(startupProfileCheckTimer);
        if (profileSyncInFlight) await profileSyncInFlight.catch(() => undefined);
        if (applyingProfile || reconnecting || drainingRetries) return openAccountPanel();
        if (bridge()?.signOut?.() === false) return openAccountPanel();
        cache(null); checkedStartupWorkspace = ""; startupProfileDecisionPending = true;
        refreshTitleAccount(); showSignInIntro();
      } },
      { label: "Cancel", kind: "secondary", run: openAccountPanel }
    ]);
  }

  async function openAccountPanel() {
    if (accountUid() === "signed-out") return showSignInIntro();
    showPanel("WonderLang account", `<p class="wl-account-muted">Loading your account…</p>`, [
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
    try {
      if (!isOffline()) await refresh();
    } catch (error) {
      if (error?.status === 401 || !bridge()?.getCachedIdToken?.()) {
        showSignInIntro();
        return;
      }
      showError("Account unavailable", error, openAccountPanel);
      return;
    }

    const access = effectiveCachedEntitlement() || {};
    const accessLabel = access.platformRestricted ? "Owned on another mobile platform" :
      access.accessKind === "subscription" ? "Mobile Monthly" :
      access.accessKind === "premium_lifetime" ? "Premium Lifetime Pass" :
      access.accessKind === "permanent" ? "Polyglot Permanent Access" : access.fullGame ? "Full game" : "Free demo";
    const subscription = current?.subscription?.phase
      ? `${trSource(String(current.subscription.phase))}${current.subscription.renewsAt ? trSource(" · renews {TIME}", { TIME: formatTime(current.subscription.renewsAt) }) : current.subscription.endsAt ? trSource(" · ends {TIME}", { TIME: formatTime(current.subscription.endsAt) }) : ""}`
      : access.subscriptionState && access.subscriptionState !== "inactive"
        ? trSource(String(access.subscriptionState))
      : "";
    const profiles = access.cloudSave && !isOffline() ? await listProfiles().catch(() => []) : [];
    if (access.cloudSave && !activeProfileId() && !isOffline()) {
      openCloudSavesPanel(true, profiles);
      return;
    }
    const activeProfile = profiles.find(profile => profile.profileId === activeProfileId()) || (workspaceMatches() ? { name: workspaceBinding()?.profileName } : null);
    const profileSwitcher = access.cloudSave ? renderProfilePicker(profiles, activeProfileId()) : "";
    const overlay = showPanel("WonderLang account", `
      <div class="wl-account-identity-row"><div class="wl-account-identity">${escapeHtml(current?.email || "Signed-in account")}</div>${profileSwitcher}</div>
      ${isOffline() ? `<p class="wl-account-error">${escapeHtml(offlineMessage())}</p>` : ""}
      <div class="wl-account-status">
        <div class="wl-account-card"><b>Access</b>${escapeHtml(accessLabel)}${access.accessKind === "subscription" && subscription ? `<p class="wl-account-muted">${escapeHtml(subscription)}</p>` : ""}</div>
        <div class="wl-account-card"><b>Save profile</b>${access.cloudSave ? escapeHtml(activeProfile?.name || "Choose a profile") : "Not included"}</div>
        <div class="wl-account-card"><b>Uploads waiting</b>${retryCount()}</div>
        <div class="wl-account-card"><b>${escapeHtml(tr("CloudAccount.Label.CloudBackup", "Cloud backup"))}</b>${escapeHtml(workspaceMatches() && workspaceBinding()?.cloudUpdatedAt ? formatTime(workspaceBinding().cloudUpdatedAt) : tr("CloudAccount.Label.NoBackupYet", "No backup yet"))}</div>
      </div>
      `, [
      { label: "Manage profiles", run: openCloudSavesPanel },
      ...(access.cloudSave ? [{ label: tr("CloudAccount.Action.SyncNow", "Cloud sync now"), run: syncFromUi }] : []),
      { label: "Manage login methods", kind: "secondary", run: () => bridge()?.openAccount?.() },
      ...((current?.subscriptions?.length ? current.subscriptions : current?.subscription ? [current.subscription] : []).map(subscription => ({
        label: tr("CloudAccount.UI.Cancelsubscription", "Cancel subscription") + " — " + ({google_play:"Google Play",apple:"Apple",stripe:"Stripe"}[subscription.provider] || subscription.provider),
        kind: "secondary", run: () => openBillingPortal(subscription)
      }))),
      { label: "Refresh", kind: "secondary", run: openAccountPanel },
      ...(typeof bridge()?.signOut === "function" ? [{ label: tr("CloudAccount.SignOut.Label", "Sign out"), kind: "secondary", run: confirmSignOut }] : []),
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
    overlay.dataset.syncSafe = "true";
    bindProfilePicker(overlay, profiles);
  }

  async function openBillingPortal(subscription = authoritativeAccount()?.subscription) {
    try {
      const provider = subscription?.provider;
      if (provider === "google_play") {
        const url = "https://play.google.com/store/account/subscriptions?sku=wonderlangmonthly&package=com.wonderlang.app";
        if (typeof bridge()?.openExternalUrl !== "function" || bridge().openExternalUrl(url) === false) throw new Error("Could not open Google Play subscriptions.");
        return;
      }
      if (provider === "apple") {
        const url = "https://apps.apple.com/account/subscriptions";
        if (typeof bridge()?.openExternalUrl !== "function" || bridge().openExternalUrl(url) === false) throw new Error("Could not open Apple subscriptions.");
        return;
      }
      if (provider !== "stripe") throw new Error("This subscription does not have a supported management provider.");
      const { url } = await request("/api/v1/billing-portal", { method: "POST", body: subscription?.id ? {subscriptionId:subscription.id} : {} });
      if (!url || typeof bridge()?.openExternalUrl !== "function" || bridge().openExternalUrl(url) === false) throw new Error("Could not open the secure billing portal.");
    } catch (error) {
      showError("Billing portal unavailable", error, openAccountPanel);
    }
  }

  async function ensureProfileSelection() {
    if (profileSelectionInFlight || !current?.uid || !effectiveCachedEntitlement()?.cloudSave || activeProfileId()) return;
    profileSelectionInFlight = true;
    try { await openCloudSavesPanel(true); }
    finally { profileSelectionInFlight = false; }
  }

  async function openCloudSavesPanel(forcePick = false, suppliedProfiles = null) {
    showPanel("Save profiles", `<p class="wl-account-muted">Loading your save profiles…</p>`, [
      ...(!forcePick || activeProfileId() ? [{ label: "Close", kind: "secondary", run: closeOverlay }] : [])
    ]);
    try {
      const profiles = suppliedProfiles || await listProfiles();
      const active = activeProfileId();
      const intro = forcePick && !active
        ? `<p class="wl-account-success">Choose a profile for this device. You can keep this device's existing saves in that profile or download its cloud saves.</p>`
        : `<p class="wl-account-muted">All saves in your selected profile sync automatically. Create up to six profiles to keep each player's progress or each learning language separate.</p>`;
      const rows = profiles.map(profile => `<div class="wl-account-save ${profile.profileId === active ? "active" : ""}">
        <div><h3>${escapeHtml(profile.name)}${profile.profileId === active ? `<span class="wl-account-active-pill">Active</span>` : ""}</h3><div class="wl-account-muted">${profile.currentRevision ? escapeHtml(trSource("Cloud updated {TIME}", { TIME: formatTime(profile.updatedAt) })) : trSource("No cloud saves yet")}</div></div>
        <div class="wl-account-save-actions"><button class="wl-account-btn" data-select-profile="${escapeHtml(profile.profileId)}" ${profile.profileId === active ? "disabled" : ""}>${trSource(profile.profileId === active ? "Selected" : "Use profile")}</button>${Array.isArray(profile.backups) && profile.backups.length ? `<button class="wl-account-btn secondary" data-profile-backups="${escapeHtml(profile.profileId)}">${escapeHtml(trSource("Restore backup ({COUNT})", { COUNT: profile.backups.length }))}</button>` : ""}<button class="wl-account-btn secondary" data-rename-profile="${escapeHtml(profile.profileId)}">${escapeHtml(trSource("Rename"))}</button></div>
      </div>`).join("");
      const overlay = showPanel("Save profiles", intro + rows, [
        ...(active && canSyncCloud() ? [{ label: tr("CloudAccount.Action.SyncNow", "Cloud sync now"), run: syncFromUi }] : []),
        ...(canSaveLocalAsNewProfile(profiles) ? [{ label: tr("CloudAccount.Action.SaveLocalAsNew", "Save local files to a new profile"), run: showSaveLocalAsNewProfile }] : []),
        ...(profiles.length < 6 ? [{ label: "Create profile", run: showCreateProfile }] : []),
        { label: "Refresh", kind: "secondary", run: openCloudSavesPanel },
        ...(!forcePick || active ? [{ label: "Back to account", kind: "secondary", run: openAccountPanel }] : []),
        ...(!forcePick || active ? [{ label: "Close", kind: "secondary", run: closeOverlay }] : [])
      ]);
      overlay.querySelectorAll("[data-select-profile]").forEach(button => bindReleaseTap(button, () => selectProfile(profiles.find(profile => profile.profileId === button.dataset.selectProfile), { profiles, onCancel: openCloudSavesPanel })));
      overlay.querySelectorAll("[data-profile-backups]").forEach(button => bindReleaseTap(button, () => openProfileBackups(profiles.find(profile => profile.profileId === button.dataset.profileBackups))));
      overlay.querySelectorAll("[data-rename-profile]").forEach(button => bindReleaseTap(button, () => showRenameProfile(profiles.find(profile => profile.profileId === button.dataset.renameProfile))));
    } catch (error) {
      showError("Save profiles unavailable", error, openCloudSavesPanel);
    }
  }

  function profileNameEditor(title, initialName, submitLabel, onSubmit, explanation = "") {
    const overlay = showPanel(title, `${explanation ? `<p class="wl-account-muted">${escapeHtml(explanation)}</p>` : ""}<p class="wl-account-muted">Choose a name for the player or language, such as Emma or Japanese.</p><input class="wl-account-input" maxlength="40" value="${escapeHtml(initialName || "")}" aria-label="${escapeHtml(trSource("Profile name"))}">`, [
      { label: submitLabel, run: async () => {
        const input = overlay.querySelector(".wl-account-input");
        const name = String(input?.value || "").trim();
        if (!name) { input?.focus(); return; }
        await onSubmit(name);
      } },
      { label: "Cancel", kind: "secondary", run: openCloudSavesPanel }
    ]);
    setTimeout(() => overlay.querySelector(".wl-account-input")?.focus(), 0);
  }

  function showCreateProfile() {
    profileNameEditor("Create save profile", "", "Create", async name => {
      try {
        showPanel("Creating profile", `<p class="wl-account-muted">${escapeHtml(trSource("Creating {PROFILE}…", { PROFILE: name }))}</p>`);
        const profile = await request("/api/v1/cloud-save-profiles", { method: "POST", body: { name } });
        await selectProfile(profile);
      } catch (error) { showError("Profile was not created", error, showCreateProfile); }
    });
  }

  function canSaveLocalAsNewProfile(profiles) {
    const binding = workspaceBinding();
    return accountUid() !== "signed-out" && hasLocalPlayerSaves() && profiles.length < 6 &&
      !(binding?.uid === accountUid() && profiles.some(profile => profile.profileId === binding.profileId));
  }

  function showSaveLocalAsNewProfile() {
    const uid = accountUid();
    let submitting = false;
    const label = tr("CloudAccount.Action.SaveLocalAsNew", "Save local files to a new profile");
    profileNameEditor(label, "", label, async name => {
      if (submitting) return;
      submitting = true;
      try {
        // Recheck ownership and available slots at submission, not just when
        // the recovery prompt was opened. The server enforces the limit too.
        const profiles = await listProfiles();
        if (accountUid() !== uid || !canSaveLocalAsNewProfile(profiles)) return openCloudSavesPanel();
        showPanel("Creating profile", `<p class="wl-account-muted">${escapeHtml(trSource("Creating {PROFILE}…", { PROFILE: name }))}</p>`);
        const binding = workspaceBinding();
        const bundle = await buildProfileBundle(binding?.profileId || "unlabelled");
        await StorageManager.saveObject(`wl-profile-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`, { binding, bundle });
        const profile = await request("/api/v1/cloud-save-profiles", { method: "POST", body: { name } });
        // This is the player's explicit adoption of unmatched local files.
        // Never route through selection, which could download an empty set.
        if (accountUid() !== uid) return openCloudSavesPanel();
        await activateProfile(profile, "device");
      } catch (error) {
        showError("Profile was not created", error, showSaveLocalAsNewProfile);
      } finally { submitting = false; }
    }, tr("CloudAccount.Profile.AdoptLocalBody", "The saves on this device do not belong to any profile on your account. Create a new profile for them? All these saves will be uploaded to the new profile. Your other profiles will not change. Enter a name to continue."));
  }

  function showRenameProfile(profile) {
    if (!profile) return openCloudSavesPanel();
    profileNameEditor("Rename save profile", profile.name, "Rename", async name => {
      try {
        await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profile.profileId)}/rename`, { method: "POST", body: { name } });
        await openCloudSavesPanel();
      } catch (error) { showError("Profile was not renamed", error, () => showRenameProfile(profile)); }
    });
  }

  async function openProfileBackups(profile) {
    if (!profile) return openCloudSavesPanel();
    showPanel("Loading profile backups", `<p class="wl-account-muted">${escapeHtml(trSource("Loading older backups for {PROFILE}…", { PROFILE: profile.name }))}</p>`, [
      { label: "Cancel", kind: "secondary", run: openCloudSavesPanel }
    ]);
    try {
      if (profile.profileId === activeProfileId()) {
        clearTimeout(profileSyncTimer);
        if (profileSyncInFlight) await profileSyncInFlight.catch(() => undefined);
        if (retryQueue()[profile.profileId]) {
          showPanel("Saving current profile", `<p class="wl-account-muted">Saving your latest progress to the cloud before showing older backups…</p>`);
          const result = await syncActiveProfileNow();
          if (result?.conflict) return;
        }
      }
      const profiles = await listProfiles();
      const refreshed = profiles.find(item => item.profileId === profile.profileId);
      if (!refreshed) throw new Error(tr("CloudAccount.Error.ContextChanged", "The account or save profile has changed. Please select your profile and try again."));
      const backups = Array.isArray(refreshed.backups) ? refreshed.backups : [];
      if (!backups.length) {
        showPanel(trSource("Backups for {PROFILE}", { PROFILE: refreshed.name }), `<p class="wl-account-muted">No older backup is available yet. After each successful sync, WonderLang keeps up to three previous backups.</p>`, [
          { label: "Back to profiles", run: openCloudSavesPanel },
          { label: "Close", kind: "secondary", run: closeOverlay }
        ]);
        return;
      }
      const rows = backups.map((backup, index) => `<div class="wl-account-save">
        <div><h3>${escapeHtml(trSource("Backup {NUMBER}", { NUMBER: index + 1 }))}</h3><div class="wl-account-muted">${escapeHtml(trSource("Saved {TIME}", { TIME: formatTime(backup.updatedAt) }))}</div></div>
        <div class="wl-account-save-actions"><button class="wl-account-btn secondary" data-restore-backup="${escapeHtml(backup.revision)}">Restore this version</button></div>
      </div>`).join("");
      const overlay = showPanel(trSource("Backups for {PROFILE}", { PROFILE: refreshed.name }), `<p class="wl-account-muted">You can restore one of the three previous backups of this profile. Each backup contains all the profile's saves.</p>${rows}`, [
        { label: "Back to profiles", kind: "secondary", run: openCloudSavesPanel },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      overlay.querySelectorAll("[data-restore-backup]").forEach(button => bindReleaseTap(button, () => {
        const backup = backups.find(item => item.revision === button.dataset.restoreBackup);
        if (backup) confirmProfileBackupRestore(refreshed, backup);
      }));
    } catch (error) {
      showError("Profile backups unavailable", error, () => openProfileBackups(profile));
    }
  }

  function confirmProfileBackupRestore(profile, backup) {
    const savedAt = formatTime(backup.updatedAt);
    showPanel(trSource("Restore {PROFILE}'s backup?", { PROFILE: profile.name }), `<p class="wl-account-muted">${escapeHtml(trSource("Restore the backup from {TIME}? It will replace this profile's current cloud saves. The current version will become one of the three older backups.", { TIME: savedAt }))}</p>`, [
      { label: "Restore backup", kind: "danger", run: () => restoreProfileBackup(profile, backup) },
      { label: "Cancel", kind: "secondary", run: () => openProfileBackups(profile) }
    ]);
  }

  async function restoreProfileBackup(profile, backup) {
    try {
      showPanel("Restoring profile backup", `<p class="wl-account-muted">${escapeHtml(trSource("Restoring {PROFILE}'s backup from {TIME}…", { PROFILE: profile.name, TIME: formatTime(backup.updatedAt) }))}</p>`);
      await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profile.profileId)}/revisions/${encodeURIComponent(backup.revision)}/restore`, {
        method: "POST",
        body: { expectedCurrentRevision: profile.currentRevision }
      });
      const isActive = profile.profileId === activeProfileId();
      if (isActive) await restoreProfile(profile.profileId);
      showPanel("Backup restored", `<p class="wl-account-success">${escapeHtml(trSource(isActive ? "{PROFILE} has been restored to the backup from {TIME}. Those saves are now on this device." : "{PROFILE} has been restored to the backup from {TIME} in the cloud. This device will download those saves when you switch to this profile.", { PROFILE: profile.name, TIME: formatTime(backup.updatedAt) }))}</p>`, [
        { label: "Continue", run: () => {
          closeOverlay();
          if (isActive && typeof Scene_Map !== "undefined" && SceneManager._scene instanceof Scene_Map) SceneManager.goto(Scene_Title);
        } },
        { label: "Back to profiles", kind: "secondary", run: openCloudSavesPanel }
      ]);
    } catch (error) {
      showError("Backup was not restored", error, () => openProfileBackups(profile));
    }
  }

  async function clearWorkspaceForProfile(profileId) {
    const globalJson = await StorageManager.objectToJson([]);
    await applyProfileBundle({ magic: "WL_CLOUD_PROFILE", version: 1, profileId, files: { global: globalJson } }, profileId);
  }

  async function activateProfile(profile, source) {
    if (!profile) return;
    try {
      if (source === "cloud") downloadPanel(profile);
      else showPanel("Switching save profile", `<p class="wl-account-muted">${escapeHtml(profile.name)}</p>`);
      if (source === "cloud") {
        await restoreProfile(profile.profileId);
        setActiveProfileId(profile.profileId);
        saveWorkspaceBinding(profile.profileId, { profileName: profile.name });
      } else {
        if (source === "empty") await clearWorkspaceForProfile(profile.profileId);
        setActiveProfileId(profile.profileId);
        saveWorkspaceBinding(profile.profileId, {
          profileName: profile.name,
          revision: profile.currentRevision || null,
          fingerprint: null,
          cloudUpdatedAt: profile.updatedAt || null,
          localChangedAt: new Date().toISOString()
        });
      }
      if (source === "device" || source === "empty") {
        const result = await uploadProfile(profile.profileId, { baseRevision: profile.currentRevision || null, showConflict: true });
        if (result?.conflict) return;
      }
      checkedStartupWorkspace = `${accountUid()}:${profile.profileId}`;
      finishStartupProfileDecision();
      showPanel("Profile ready", `<p class="wl-account-success">${escapeHtml(trSource("{PROFILE} is ready. All saves in this profile will sync automatically.", { PROFILE: profile.name }))}</p>`, [
        { label: "Continue", run: () => {
          closeOverlay();
          if (typeof Scene_Map !== "undefined" && SceneManager._scene instanceof Scene_Map) SceneManager.goto(Scene_Title);
        } },
        { label: "Account", kind: "secondary", run: openAccountPanel }
      ]);
    } catch (error) { showError("Could not switch profile", error, () => selectProfile(profile)); }
  }

  async function switchFromActiveProfile(profile) {
    try {
      showPanel("Saving current profile", `<p class="wl-account-muted">Saving this profile's progress to the cloud before switching…</p>`);
      const result = await syncActiveProfileNow();
      if (result?.conflict) return;
      return activateProfile(profile, profile.currentRevision ? "cloud" : "empty");
    } catch (error) {
      showError("Profile switch paused", new Error(trSource("Your current profile could not be uploaded, so the profile was not switched. Check your internet connection and try again. {ERROR}", { ERROR: playerErrorMessage(error) })), () => switchFromActiveProfile(profile));
    }
  }

  async function selectProfile(profile, options = {}) {
    const onCancel = typeof options.onCancel === "function" ? options.onCancel : openCloudSavesPanel;
    if (!profile || profile.profileId === activeProfileId()) return onCancel();
    const previous = activeProfileId();
    if (previous) {
      const binding = workspaceBinding();
      if (!workspaceMatches(previous)) {
        if (binding?.uid === accountUid() && binding.profileId === profile.profileId) {
          setActiveProfileId(profile.profileId);
          checkedStartupWorkspace = "";
          closeOverlay();
          scheduleStartupProfileCheck(50, true);
          return;
        }
        const availableProfiles = Array.isArray(options.profiles) ? options.profiles : await listProfiles().catch(() => []);
        // Recovery must offer the requested destination, not trap the player
        // on the previously selected profile whose local binding is stale.
        showWorkspaceMismatchPrompt(profile, binding, availableProfiles);
        return;
      }
      const currentProfile = Array.isArray(options.profiles) ? options.profiles.find(item => item.profileId === previous) : null;
      const currentName = currentProfile?.name || "the current profile";
      showPanel(trSource("Switch to {PROFILE}?", { PROFILE: profile.name }), `<p class="wl-account-muted">${escapeHtml(trSource("First, all saves for {CURRENT} on this device will be uploaded to the cloud. Then {NEXT}'s cloud saves will be downloaded to this device. If the upload fails, you will stay on {CURRENT}.", { CURRENT: currentName, NEXT: profile.name }))}</p>`, [
        { label: "Sync and switch", run: () => switchFromActiveProfile(profile) },
        { label: "Cancel", kind: "secondary", run: onCancel }
      ]);
      return;
    }
    if (hasLocalPlayerSaves() && profile.currentRevision) {
      showPanel(trSource("Use {PROFILE} on this device?", { PROFILE: profile.name }), `<p class="wl-account-muted">This device and this profile both have saves. Keep this device's saves to upload them to the profile, or use the cloud saves to replace the saves on this device. The two versions will not be combined.</p>`, [
        { label: "Keep device saves", run: () => activateProfile(profile, "device") },
        { label: "Use cloud saves", kind: "danger", run: () => activateProfile(profile, "cloud") },
        { label: "Cancel", kind: "secondary", run: openCloudSavesPanel }
      ]);
      return;
    }
    return activateProfile(profile, hasLocalPlayerSaves() ? "device" : profile.currentRevision ? "cloud" : "empty");
  }

  function hasRunningGame() {
    const types = [globalThis.Scene_Map, globalThis.Scene_Battle].filter(type => typeof type === "function");
    return types.some(type => globalThis.SceneManager?._scene instanceof type || globalThis.SceneManager?._stack?.includes(type));
  }

  async function presentProfileConflict(profileId) {
    conflictProfileId = profileId;
    startupProfileDecisionPending = true;
    let remote;
    try {
      const downloaded = await downloadProfile(profileId);
      remote = downloaded.remote;
      const generation = saveWriteGeneration;
      const localFingerprint = await profileFilesFingerprint((await buildProfileBundle(profileId)).files);
      const cloudFingerprint = await profileFilesFingerprint(downloaded.bundle.files);
      // A finalize response may have been lost even though the server committed.
      // Identical content is already synced, not a two-device conflict.
      if (workspaceMatches(profileId) && localFingerprint === cloudFingerprint) {
        setRevision(profileId, remote.manifest.currentRevision);
        const settled = generation === saveWriteGeneration;
        saveWorkspaceBinding(profileId, {
          revision: remote.manifest.currentRevision, fingerprint: cloudFingerprint,
          cloudUpdatedAt: remote.manifest.updatedAt, ...(settled ? { localChangedAt: null } : {})
        });
        if (settled) clearQueuedProfile(profileId);
        finishStartupProfileDecision();
        showPanel(tr("CloudAccount.Startup.SyncedTitle", "Cloud backup updated"), "<p class='wl-account-success'>" + escapeHtml(tr("CloudAccount.Startup.SyncedBody", "The latest local saves for {PROFILE} are safely stored in the WonderLang cloud.", { PROFILE: workspaceBinding()?.profileName || profileId })) + "</p>", [{ label: "Continue", run: closeOverlay }]);
        return { reconciled: true, currentRevision: remote.manifest.currentRevision };
      }
    }
    catch (error) { showError("Cloud-profile conflict", error, () => presentProfileConflict(profileId)); return; }
    showPanel("This profile changed on two devices", `<p class="wl-account-muted">This device and the cloud have different saves for this profile. Nothing has been replaced yet. Choose which saves to keep. They will replace the other version.</p><div class="wl-account-status"><div class="wl-account-card"><b>This device</b>${escapeHtml(latestLocalSaveTime(workspaceBinding()) ? formatTime(latestLocalSaveTime(workspaceBinding())) : tr("CloudAccount.Label.ChangedLocally", "Changed locally"))}</div><div class="wl-account-card"><b>Cloud</b>${escapeHtml(formatTime(remote.manifest.updatedAt))}</div></div>`, [
      { label: "Keep this device", run: async () => {
        try {
          const result = await uploadProfile(profileId, { baseRevision: remote.manifest.currentRevision, showConflict: true });
          if (result?.conflict || result?.skipped) return;
          conflictProfileId = "";
          finishStartupProfileDecision();
          closeOverlay();
        }
        catch (error) { showError("Device profile was not uploaded", error, () => presentProfileConflict(profileId)); }
      } },
      { label: "Use cloud profile", kind: "danger", run: async () => {
        try {
          await restoreProfile(profileId);
          conflictProfileId = "";
          finishStartupProfileDecision();
          closeOverlay();
          // Do not let an already-running game overwrite the chosen cloud copy.
          if (hasRunningGame()) SceneManager.goto(Scene_Title);
        }
        catch (error) { showError("Cloud profile was not restored", error, () => presentProfileConflict(profileId)); }
      } },
      { label: "Not now", kind: "secondary", run: closeOverlay }
    ]);
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-conflict", { detail: { profileId, remote: remote.manifest } }));
  }

  function latestLocalSaveTime(binding = null) {
    const timestamps = [Date.parse(binding?.localChangedAt || "") || 0];
    const globalInfo = Array.isArray(DataManager._globalInfo) ? DataManager._globalInfo : [];
    for (const info of globalInfo) {
      if (!info || typeof info !== "object") continue;
      timestamps.push(Number(info.timestamp || 0), Date.parse(info.updatedAt || info.savedAt || "") || 0);
    }
    const latest = Math.max(0, ...timestamps);
    return latest ? new Date(latest).toISOString() : null;
  }

  function finishStartupProfileDecision() {
    conflictProfileId = "";
    startupProfileDecisionPending = false;
    drainUploadQueue().catch(error => console.warn("[WonderLang Cloud Save] Retry queue paused.", safeMessage(error)));
  }

  async function acceptUnlabelledWorkspace(profile) {
    const bundle = await buildProfileBundle(profile.profileId);
    saveWorkspaceBinding(profile.profileId, {
      profileName: profile.name,
      revision: profile.currentRevision || null,
      fingerprint: await profileFilesFingerprint(bundle.files),
      cloudUpdatedAt: profile.updatedAt || null,
      localChangedAt: latestLocalSaveTime() || new Date().toISOString()
    });
    markProfileDirty(profile.profileId);
    showLocalSaveFreshnessPrompt(profile, workspaceBinding());
  }

  async function showUnlabelledWorkspacePrompt(profile) {
    const profiles = await listProfiles().catch(() => null);
    showPanel(tr("CloudAccount.Startup.UnlabelledTitle", "Which profile owns these saves?"),
      `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.Startup.UnlabelledBody", "Do the saves on this device belong to {PROFILE}? Confirm only if you are sure. Otherwise, choose another profile or download this profile's cloud saves instead.", { PROFILE: profile.name }))}</p>`, [
        { label: tr("CloudAccount.Action.ConfirmProfileSaves", "These are {PROFILE}'s saves", { PROFILE: profile.name }), run: () => acceptUnlabelledWorkspace(profile).catch(error => showError(tr("CloudAccount.Error.Title", "Cloud-save check failed"), error, () => showUnlabelledWorkspacePrompt(profile))) },
        ...(profile.currentRevision ? [{ label: tr("CloudAccount.Action.UseCloudCopy", "Use {PROFILE}'s cloud saves", { PROFILE: profile.name }), kind: "danger", run: () => useProfileCloudCopy(profile) }] : []),
        ...(profiles && canSaveLocalAsNewProfile(profiles) ? [{ label: tr("CloudAccount.Action.SaveLocalAsNew", "Save local files to a new profile"), run: showSaveLocalAsNewProfile }] : []),
        { label: tr("CloudAccount.Action.ChooseProfile", "Choose another profile"), kind: "secondary", run: () => openCloudSavesPanel(true) },
        { label: tr("CloudAccount.Action.NotNow", "Not now"), kind: "secondary", run: closeOverlay }
      ]);
  }

  async function useProfileCloudCopy(profile) {
    try {
      downloadPanel(profile);
      await restoreProfile(profile.profileId);
      setActiveProfileId(profile.profileId);
      saveWorkspaceBinding(profile.profileId, { profileName: profile.name });
      checkedStartupWorkspace = `${accountUid()}:${profile.profileId}`;
      finishStartupProfileDecision();
      showPanel(tr("CloudAccount.Startup.CloudReadyTitle", "Cloud saves ready"), `<p class="wl-account-success">${escapeHtml(tr("CloudAccount.Startup.CloudReadyBody", "{PROFILE}'s cloud saves are now active on this device.", { PROFILE: profile.name }))}</p>`, [
        { label: tr("CloudAccount.Action.Continue", "Continue"), run: closeOverlay }
      ]);
    } catch (error) {
      // Repeated native account refreshes must not reopen a failed restore.
      // The visible retry/profile controls still allow an explicit new attempt.
      failedStartupWorkspace = `${accountUid()}:${profile.profileId}`;
      showError(tr("CloudAccount.Error.CloudLoadTitle", "Cloud saves were not loaded"), error, () => useProfileCloudCopy(profile));
    }
  }

  function showWorkspaceMismatchPrompt(profile, binding, profiles) {
    const boundProfile = binding?.uid === accountUid() ? profiles.find(item => item.profileId === binding.profileId) : null;
    const ownerName = binding?.profileName || boundProfile?.name || tr("CloudAccount.Label.AnotherProfile", "another profile");
    showPanel(tr("CloudAccount.Startup.MismatchTitle", "Local saves belong to another profile"),
      `<p class="wl-account-error">${escapeHtml(tr("CloudAccount.Startup.MismatchBody", "The saves on this device belong to {OWNER}, not {ACTIVE}. They will not be uploaded to {ACTIVE}. Choose their profile, or download {ACTIVE}'s cloud saves. Downloading replaces the saves on this device after keeping a recovery copy here. It does not change the saves in the cloud.", { OWNER: ownerName, ACTIVE: profile.name }))}</p>`, [
        ...(canSaveLocalAsNewProfile(profiles) ? [{ label: tr("CloudAccount.Action.SaveLocalAsNew", "Save local files to a new profile"), run: showSaveLocalAsNewProfile }] : []),
        ...(boundProfile ? [{ label: tr("CloudAccount.Action.ReturnToProfile", "Return to {PROFILE}", { PROFILE: boundProfile.name }), run: () => {
          setActiveProfileId(boundProfile.profileId);
          checkedStartupWorkspace = "";
          closeOverlay();
          scheduleStartupProfileCheck(50, true);
        } }] : []),
        ...(profile.currentRevision ? [{ label: tr("CloudAccount.Action.UseCloudCopy", "Use {PROFILE}'s cloud saves", { PROFILE: profile.name }), kind: "danger", run: () => useProfileCloudCopy(profile) }] : []),
        { label: tr("CloudAccount.Action.ManageProfiles", "Manage profiles"), kind: "secondary", run: openCloudSavesPanel },
        { label: tr("CloudAccount.Action.NotNow", "Not now"), kind: "secondary", run: closeOverlay }
      ]);
  }

  function showLocalSaveFreshnessPrompt(profile, binding) {
    const localTime = latestLocalSaveTime(binding);
    showPanel(tr("CloudAccount.Startup.NewerTitle", "Newer local saves found"),
      `<p class="wl-account-success">${escapeHtml(tr("CloudAccount.Startup.NewerBody", "Your latest saves for profile “{PROFILE}” are not yet in the cloud. Upload all saves for this profile now?", { PROFILE: profile.name }))}</p><div class="wl-account-status"><div class="wl-account-card"><b>${escapeHtml(tr("CloudAccount.Label.ThisDevice", "This device"))}</b>${escapeHtml(localTime ? formatTime(localTime) : tr("CloudAccount.Label.ChangedLocally", "Changed locally"))}</div><div class="wl-account-card"><b>${escapeHtml(tr("CloudAccount.Label.CloudBackup", "Cloud backup"))}</b>${escapeHtml(profile.updatedAt ? formatTime(profile.updatedAt) : tr("CloudAccount.Label.NoBackupYet", "No backup yet"))}</div></div>`, [
        { label: tr("CloudAccount.Action.SyncNow", "Cloud sync now"), run: async () => {
          try {
            startupProfileDecisionPending = false;
            showPanel(tr("CloudAccount.Startup.SyncingTitle", "Syncing newer saves"), `<p class="wl-account-muted">${escapeHtml(tr("CloudAccount.Startup.SyncingBody", "Uploading {PROFILE}'s saves to the cloud…", { PROFILE: profile.name }))}</p>`);
            const result = await uploadProfile(profile.profileId, { showConflict: true });
            if (result?.conflict) return;
            finishStartupProfileDecision();
            showPanel(tr("CloudAccount.Startup.SyncedTitle", "Cloud backup updated"), `<p class="wl-account-success">${escapeHtml(tr("CloudAccount.Startup.SyncedBody", "The latest local saves for {PROFILE} are safely stored in the WonderLang cloud.", { PROFILE: profile.name }))}</p>`, [
              { label: tr("CloudAccount.Action.Continue", "Continue"), run: closeOverlay }
            ]);
          } catch (error) {
            startupProfileDecisionPending = true;
            showError(tr("CloudAccount.Error.UploadTitle", "Newer saves were not uploaded"), error, () => showLocalSaveFreshnessPrompt(profile, workspaceBinding()));
          }
        } },
        { label: tr("CloudAccount.Action.NotNow", "Not now"), kind: "secondary", run: closeOverlay }
      ]);
  }

  async function checkStartupProfileFreshness(force = false) {
    if (document.hidden || Date.now() < foregroundReadyAt) return "deferred";
    if (isOffline()) { noteOffline(); return "offline"; }
    if (startupProfileCheckInFlight) return startupProfileCheckInFlight;
    startupProfileCheckInFlight = (async () => {
      const uid = accountUid();
      const profileId = activeProfileId();
      if (uid === "signed-out" || !profileId || !effectiveCachedEntitlement()?.cloudSave) {
        startupProfileDecisionPending = false;
        return "not_applicable";
      }
      const signature = `${uid}:${profileId}`;
      if (failedStartupWorkspace === signature) return "awaiting_retry";
      if (!force && checkedStartupWorkspace === signature) return "already_checked";
      if (activeOverlay) return "deferred";
      const profiles = await listProfiles();
      const profile = profiles.find(item => item.profileId === profileId);
      if (!profile) {
        startupProfileDecisionPending = true;
        return openCloudSavesPanel(true, profiles);
      }
      checkedStartupWorkspace = signature;
      const binding = workspaceBinding();
      if (!workspaceMatches(profileId)) {
        startupProfileDecisionPending = true;
        if (hasLocalPlayerSaves()) {
          if (binding) showWorkspaceMismatchPrompt(profile, binding, profiles);
          else showUnlabelledWorkspacePrompt(profile);
        } else if (profile.currentRevision) {
          await useProfileCloudCopy(profile);
        } else {
          saveWorkspaceBinding(profileId, { profileName: profile.name, revision: null, fingerprint: await profileFilesFingerprint((await buildProfileBundle(profileId)).files), localChangedAt: null });
          finishStartupProfileDecision();
        }
        return "binding_required";
      }
      saveWorkspaceBinding(profileId, { profileName: profile.name });
      const checkedGeneration = saveWriteGeneration;
      const bundle = await buildProfileBundle(profileId);
      const fingerprint = await profileFilesFingerprint(bundle.files);
      if (pendingSaveWrites.size || checkedGeneration !== saveWriteGeneration) return "deferred";
      if (binding.fingerprint === fingerprint) {
        clearQueuedProfile(profileId);
        saveWorkspaceBinding(profileId, { localChangedAt: null });
        if (profile.currentRevision && profile.currentRevision !== binding.revision) {
          if (hasRunningGame()) {
            await presentProfileConflict(profileId);
            return "conflict";
          }
          await useProfileCloudCopy(profile);
          return "downloaded";
        }
        finishStartupProfileDecision();
        return "clean";
      }
      startupProfileDecisionPending = true;
      if (binding.revision && profile.currentRevision && binding.revision !== profile.currentRevision) {
        await presentProfileConflict(profileId);
        return "conflict";
      }
      showLocalSaveFreshnessPrompt(profile, binding);
      return "local_changes";
    })().catch(error => {
      console.warn("[WonderLang Cloud Save] Startup freshness check paused.", safeMessage(error));
      return "error";
    }).finally(() => { startupProfileCheckInFlight = null; });
    return startupProfileCheckInFlight;
  }

  function scheduleStartupProfileCheck(delay = 750, force = false) {
    clearTimeout(startupProfileCheckTimer);
    startupProfileCheckTimer = setTimeout(async () => {
      const result = await checkStartupProfileFreshness(force);
      if (result === "deferred") scheduleStartupProfileCheck(1000, force);
    }, delay);
  }

  const originalSaveObject = StorageManager.saveObject;
  StorageManager.saveObject = function(saveName, object) {
    const managed = /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""));
    const write = originalSaveObject.call(this, saveName, object);
    if (managed) pendingSaveWrites.add(write);
    return write.then(result => {
      pendingSaveWrites.delete(write);
      if (managed) saveWriteGeneration += 1;
      if (!applyingProfile && /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""))) scheduleProfileSync();
      return result;
    }, error => {
      pendingSaveWrites.delete(write);
      throw error;
    });
  };
  const originalRemoveSave = StorageManager.remove;
  StorageManager.remove = function(saveName) {
    const result = originalRemoveSave.call(this, saveName);
    if (!applyingProfile && /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""))) {
      const removal = Promise.resolve(result);
      pendingSaveWrites.add(removal);
      removal.then(() => {
        pendingSaveWrites.delete(removal);
        saveWriteGeneration += 1;
        scheduleProfileSync();
      }, () => pendingSaveWrites.delete(removal));
    }
    return result;
  };

  window.WLAccountEntitlements = {
    titleAccountLabel,
    refresh,
    account,
    current: entitlement,
    currentOfflineSafe: effectiveCachedEntitlement,
    isProductPurchased: ownsProduct,
    listProfiles,
    uploadActiveProfile: syncActiveProfileNow,
    syncFromUi,
    canSyncCloud,
    bindReleaseTap,
    restoreProfile,
    checkStartupProfileFreshness: () => checkStartupProfileFreshness(true),
    activeProfileId,
    openAccount: openAccountPanel,
    openCloudSaves: openCloudSavesPanel,
    openSignIn: beginSignIn,
    _nativeToken(token) {
      const waiters = tokenWaiters;
      tokenWaiters = [];
      waiters.forEach(resolve => resolve(String(token || "")));
      if (token) refresh().catch(error => console.warn("[WonderLang Account] Entitlement refresh failed.", error));
    },
    _nativeAccount(payload) {
      try {
        const value = typeof payload === "string" ? JSON.parse(payload) : payload;
        if (!value || typeof value !== "object") throw new Error("Invalid account snapshot.");
        cache(value);
        window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: value.entitlements || null }));
        if (activeProfileId()) scheduleStartupProfileCheck(750);
        else ensureProfileSelection().catch(error => console.warn("[WonderLang Cloud Save] Profile selection paused.", safeMessage(error)));
      } catch (error) {
        console.warn("[WonderLang Account] Native account snapshot was invalid.", error);
      }
    },
    _nativePurchaseVerified(payload) {
      try {
        const result = typeof payload === "string" ? JSON.parse(payload) : payload;
        if (!result?.entitlements) throw new Error("The verified purchase response was incomplete.");
        cache(current?.uid ? { ...current, entitlements: result.entitlements } : { entitlements: result.entitlements });
        window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: result.entitlements }));
        window.dispatchEvent(new CustomEvent("wl-purchase-verification-complete", { detail: { ok: true } }));
        refresh().catch(error => console.warn("[WonderLang Account] Post-purchase refresh failed.", error));
      } catch (error) {
        this._nativePurchaseFailed(safeMessage(error, "The verified purchase response was invalid."));
      }
    },
    _nativePurchaseFailed(message) {
      const text = String(message || "Purchase verification failed.").slice(0, 300);
      console.warn("[WonderLang Account] Purchase verification failed.", text);
      window.dispatchEvent(new CustomEvent("wl-purchase-verification-complete", { detail: { ok: false, message: text } }));
    },
    _nativeSignedOut() {
      cache(null);
      refreshTitleAccount();
      window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: null }));
    }
  };

  window.addEventListener("wl-device-sign-in-state", event => showDeviceSignInState(event.detail));

  // The cloud dialog owns input. Pause game events/autosaves underneath it,
  // especially while the player is choosing which complete save set to keep.
  if (globalThis.SceneManager?.updateScene) {
    const updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function() {
      if (activeOverlay) return;
      return updateScene.apply(this, arguments);
    };
  }

  window.addEventListener("offline", noteOffline);
  window.addEventListener("online", () => { resumeCloudSync(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // Android can suspend requests and report a transient offline state while
    // resuming the WebView. Recheck after connectivity/token refresh settles.
    foregroundReadyAt = Date.now() + 5000;
    setTimeout(() => {
      if (document.hidden) return;
      if (deviceOffline()) noteOffline();
      else resumeCloudSync();
    }, 5000);
  });
  window.addEventListener("wl-entitlements-updated", refreshTitleAccount);
  setInterval(showOfflineNotice, 2000);
  setInterval(() => {
    if (document.hidden || Date.now() < foregroundReadyAt) return;
    if (deviceOffline()) { noteOffline(); return; }
    if (networkUnavailable || retryCount()) resumeCloudSync();
  }, 15000);
  setTimeout(() => { if (retryCount()) resumeCloudSync(); }, 1500);
  scheduleStartupProfileCheck(3_000);

  PluginManager.registerCommand(pluginName, "openAccount", openAccountPanel);
  PluginManager.registerCommand(pluginName, "openCloudSaves", openCloudSavesPanel);
  PluginManager.registerCommand(pluginName, "refreshEntitlements", () => refresh().catch(error => showError("Account refresh failed", error, openAccountPanel)));

  if (openOnPlaytest && typeof Utils !== "undefined" && Utils.isOptionValid?.("test")) {
    let openedForPlaytest = false;
    const originalOnSceneStart = SceneManager.onSceneStart;
    SceneManager.onSceneStart = function() {
      const result = originalOnSceneStart.apply(this, arguments);
      const scene = this._scene;
      const readyScene = (typeof Scene_Title !== "undefined" && scene instanceof Scene_Title)
        || (typeof Scene_Map !== "undefined" && scene instanceof Scene_Map);
      if (!openedForPlaytest && readyScene) {
        openedForPlaytest = true;
        setTimeout(() => openAccountPanel(), 250);
      }
      return result;
    };
  }
})();
