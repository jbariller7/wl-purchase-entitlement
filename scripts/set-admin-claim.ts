import { firebaseAuth, firestore } from "../src/infrastructure/firebase.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = argument("--email")?.trim().toLowerCase();
const confirmation = argument("--confirm");
const remove = process.argv.includes("--remove");

if (!email || !email.includes("@")) {
  throw new Error("Usage: npm run admin:set-claim -- --email owner@example.com --confirm 'SET ADMIN owner@example.com' [--remove]");
}
const expected = `${remove ? "REMOVE" : "SET"} ADMIN ${email}`;
if (confirmation !== expected) throw new Error(`Refusing to continue. Pass --confirm '${expected}' exactly.`);

const auth = firebaseAuth();
const user = await auth.getUserByEmail(email);
if (!user.emailVerified) throw new Error("Refusing to grant administrator access to an unverified email address.");
const current = user.customClaims ?? {};
await auth.setCustomUserClaims(user.uid, { ...current, admin: remove ? false : true });
await auth.revokeRefreshTokens(user.uid);
await firestore().collection("adminBootstrapAudit").add({
  action: remove ? "admin_claim.remove" : "admin_claim.set",
  targetUid: user.uid,
  targetEmail: email,
  executedFrom: "set-admin-claim-script",
  createdAt: new Date().toISOString()
});
console.log(`${remove ? "Removed" : "Set"} administrator claim for ${email}. Existing sessions were revoked; sign in again.`);
