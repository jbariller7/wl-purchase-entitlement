import {
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, updatePassword, validatePassword, reload
} from "firebase/auth";

const passwordFields = `
  <label><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
  <label><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
  <p>Use at least 12 characters.</p>`;
const emailField = '<label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>';
const support = '<p><span>Cannot receive emails? Contact support to recover your account.</span> <a href="mailto:contact@wonderlang.app">contact@wonderlang.app</a></p>';

export function installPasswordForms(host, demo) {
  host.querySelector('[data-form="password"]').closest("details").open = true;
  host.querySelector(".wl-signed-out").insertAdjacentHTML("beforeend", `
    <details><summary>Create an account</summary><form class="wl-password-form" data-password-flow="create">${emailField}${passwordFields}<button>Create an account</button></form></details>
    <details><summary>Forgot password?</summary><form class="wl-password-form" data-password-flow="reset">${emailField}<button>Send reset email</button></form>${support}</details>`);
  host.querySelector(".wl-signed-in").insertAdjacentHTML("afterbegin", `
    <section data-password-verification hidden><p>Verify your email to claim purchases. Open the verification email, then refresh your account here.</p><button type="button" data-password-verify>Send verification email</button><button type="button" class="wl-secondary" data-password-refresh>Refresh account</button>${support}</section>
    <details data-password-settings><summary>Set or change password</summary><form class="wl-password-form" data-password-flow="set">${passwordFields}<button>Save password</button></form></details>`);
  host.querySelector(".wl-status").insertAdjacentHTML("afterend", `
    <section data-password-recovery hidden><h3>Recover your account</h3><p>Choose your password to finish account recovery.</p><form class="wl-password-form" data-password-flow="recover">${passwordFields}<button>Save password and sign in</button></form><button type="button" class="wl-secondary" data-password-cancel>Cancel</button>${support}</section>`);
  host.querySelector(".wl-status").after(host.querySelector("[data-password-verification]"));
  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.textContent = "Continue";
  continueButton.dataset.passwordContinue = "";
  continueButton.hidden = true;
  host.querySelector(".wl-signed-out").prepend(continueButton);
  continueButton.addEventListener("click", async () => {
    if (!host.auth?.currentUser) return;
    host.handoffReady = true;
    await host.renderUser(host.auth.currentUser);
  });
  const fragment = new URLSearchParams(location.hash.slice(1));
  const incoming = fragment.get("recovery");
  if (incoming) {
    fragment.delete("recovery");
    history.replaceState({}, "", location.pathname + location.search + (fragment.size ? "#" + fragment : ""));
    sessionStorage.setItem("wl-password-recovery", incoming);
  }
  const saved = sessionStorage.getItem("wl-password-recovery");
  const match = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})$/.exec(saved || "");
  host.passwordRecovery = match ? {uid:match[1],token:match[2]} : null;
  host.querySelector("[data-password-recovery]").hidden = !host.passwordRecovery;
  const login = host.querySelector('[data-form="password"]').closest("details");
  host.querySelector(".wl-provider-grid").after(login);
  host.querySelector(".wl-divider").remove();
  const emailLinks = document.createElement("details");
  const emailSummary = document.createElement("summary");
  emailSummary.textContent = "Email me a sign-in link";
  emailLinks.append(emailSummary, host.querySelector('[data-form="email"]'), host.querySelector('[data-field="email-notice"]'));
  host.querySelector(".wl-signed-out").append(emailLinks);
  host.querySelector("[data-password-cancel]").addEventListener("click", async () => {
    sessionStorage.removeItem("wl-password-recovery");
    host.passwordRecovery = null;
    host.querySelector("[data-password-recovery]").hidden = true;
    await host.renderUser(host.auth?.currentUser || null);
  });

  host.querySelectorAll("[data-password-flow]").forEach(form => form.addEventListener("submit",event => {
    event.preventDefault(); void performPassword(host, form,form.dataset.passwordFlow, demo);
  }));
  host.querySelector('[data-form="password"]').addEventListener("submit",event => {
    event.preventDefault(); void performPassword(host, event.currentTarget,"signin", demo);
  });
  host.querySelector("[data-password-verify]").addEventListener("click", async event => {
    if (demo || !host.auth?.currentUser) return;
    event.currentTarget.disabled = true;
    try {
      host.auth.languageCode = host.lang || "en";
      await sendEmailVerification(host.auth.currentUser,{url:location.origin+"/account/"});
      host.status("Verify your email to claim purchases. Open the verification email, then refresh your account here.");
    } catch {host.status("Unable to complete this request. Try again or contact support.");}
    finally {host.querySelector("[data-password-verify]").disabled = false;}
  });
  host.querySelector("[data-password-refresh]").addEventListener("click", async () => {
    if (demo || !host.auth?.currentUser) return;
    try {
      await reload(host.auth.currentUser);
      await host.auth.currentUser.getIdToken(true);
      if (host.desktopHandoff && host.auth.currentUser.emailVerified) host.handoffReady = true;
      await host.renderUser(host.auth.currentUser);
    } catch {host.status("Unable to complete this request. Try again or contact support.");}
  });
}

export function showPasswordState(host, user) {
  const recovering = Boolean(host.passwordRecovery);
  host.querySelector("[data-password-continue]").hidden = !user || !host.desktopHandoff || recovering;
  host.querySelector("[data-password-recovery]").hidden = !recovering;
  host.querySelector("[data-password-verification]").hidden = recovering || !user || user.emailVerified;
  host.querySelector("[data-password-settings]").hidden = !user?.emailVerified;
  if (recovering) {
    host.querySelector(".wl-status").hidden = true;
    host.querySelector(".wl-signed-out").hidden = true;
    host.querySelector(".wl-signed-in").hidden = true;
    return true;
  }
  return false;
}

export async function performPassword(host, form, flow, demo = false) {
    if (host.passwordFlowBusy || !host.auth || demo) return;
    const fields = new FormData(form);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    const controls = [...form.querySelectorAll("button,input")];
    host.passwordFlowBusy = true;
    controls.forEach(control => { control.disabled = true; });
    host.status("Please wait…");
    try {
      if (["create","set","recover"].includes(flow)) {
        if (password !== fields.get("confirm")) throw Error("Passwords do not match.");
        if (password.length < 12 || password.length > 128 || !(await validatePassword(host.auth,password)).isValid) {
          throw Error("Choose a stronger password with at least 12 characters.");
        }
      }
      host.auth.languageCode = host.lang || "en";
      const settings = {url:location.origin + "/account/", handleCodeInApp:false};
      if (flow === "reset") {
        try { await sendPasswordResetEmail(host.auth,email,settings); }
        catch (error) { if (error.code !== "auth/user-not-found") throw error; }
        host.status("If this email has a password account, a reset link has been sent. Check your inbox and spam folder.");
      } else if (flow === "set") {
        if (!host.auth.currentUser?.emailVerified) throw Error("Verify your email before setting a password.");
        await updatePassword(host.auth.currentUser,password);
        host.status("Password saved. You can now sign in with your email and password.");
      } else if (flow === "create") {
        const {user} = await createUserWithEmailAndPassword(host.auth,email,password);
        // Keep the account usable for retrying verification even if sending fails.
        await host.renderUser(user);
        await sendEmailVerification(user,settings);
        host.status("Verify your email to claim purchases. Open the verification email, then refresh your account here.");
      } else {
        let loginEmail = email;
        if (flow === "recover") {
          const result = await host.request("/.netlify/functions/password-recovery",{
            authenticated:false, method:"POST",body:{...host.passwordRecovery,password}
          });
          loginEmail = result.email;
          const wait = Math.max(0, Math.min(2000, (result.signInAfter || 0) - Date.now()));
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          host.passwordRecovery = null;
          sessionStorage.removeItem("wl-password-recovery");
          host.querySelector("[data-password-recovery]").hidden = true;
          // Keep the address available if the sign-in network request needs retrying.
          host.querySelector('[data-form="password"] input[name="email"]').value = loginEmail;
          await host.renderUser(null);
        }
        const {user} = await signInWithEmailAndPassword(host.auth,loginEmail,password);
        if (host.desktopHandoff) host.handoffReady = true;
        await host.renderUser(user);
      }
      form.reset();
    } catch (error) {
      const code = error.code;
      const message = code === "auth/requires-recent-login"
        ? "Sign out and sign in again, then set your password."
        : ["auth/email-already-in-use","auth/account-exists-with-different-credential"].includes(code)
          ? "This email already has an account. Sign in, reset your password, or contact support."
          : flow === "recover" ? "Recovery could not finish. Try signing in with your new password or ask support for a new link."
          : null;
      if (!code && ["Passwords do not match.","Verify your email before setting a password.","Choose a stronger password with at least 12 characters."].includes(error.message)) host.status(error.message);
      else if (message) host.status(message);
      else if (["auth/invalid-credential","auth/wrong-password","auth/user-not-found"].includes(code)) host.status("Incorrect email or password.");
      else if (code === "auth/too-many-requests") host.status("Too many attempts. Please try again later.");

      else host.status("Unable to complete this request. Try again or contact support.");
    } finally {
      controls.forEach(control => {control.disabled = false;});
      host.passwordFlowBusy = false;
    }
  }
