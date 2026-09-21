# Store reviewer access

The browser account page offers email/password login alongside existing providers.
Firebase Email/Password must be enabled. No app assets are changed by this feature.

## Provisioning and credentials

Admin Overview provides two fixed review-account slots (Apple and Google Play).
Create generates a random email identifier on wonderlang.app and a strong password,
creates a disabled Firebase user, grants Premium Lifetime, records an audit entry,
then enables the user. It never adopts an existing customer, sets an admin claim,
or marks an unverified mailbox as verified. The accounts need no inbox.

The password appears once in the authenticated creation response. It is not stored
in Firestore, logs, audit entries or source. Save it privately in store review notes.
Never publish reviewer credentials, sign-in links or tokens in this repository.
If provisioning fails partway, the account remains disabled. An administrator must
inspect its grant and registry entry and reset its Firebase password before enabling
it; retrying Create will never overwrite an existing account.

## Reviewer instructions

On the test device, visit https://wonderlang.app/account/ and expand
**Sign in with a password**. Enter the supplied credentials. For a PC/Mac request
opened by the game, the existing browser approval automatically completes.

For Android, tap **Generate game sign-in link**, then **Open WonderLang**.
If the app asks for an email, enter the supplied reviewer email. There is no inbox
step. This uses the installed app's existing Firebase Hosting email-link handler.
Start from a signed-out game; a remembered email for a different account can cause
the native handler to reject the link. The game must use the same Firebase project.

iOS also requires its Firebase email-link/universal-link integration and the
registered com.wonderlang.app bundle. Creating the account does not implement this
in a build that lacks it. Test the current Mac build before submitting these notes
to Apple. Browser-only changes cannot repair a missing native handler.

## Monitoring

Overview shows total successful credential sessions observed by the authenticated
account API, last 24 hours, last 7 days and latest authentication time. Counts begin
at provisioning. Firestore transactions deduplicate by server-verified auth_time
and provider: page refreshes, API retries and token renewal do not add logins.
Desktop custom-token handoffs are excluded. Browser login plus native email-link
login count separately. Two authentications in the same second using the same
provider are indistinguishable. This is not a device count or a Firebase-wide
authentication audit; sign-ins that never contact the account API are not counted.

Use **Manage account** to disable an account, revoke sessions or review its grant.
No automatic login limit or expiry interferes with store review. Existing offline
entitlement caches can delay revocation on a disconnected device.

The mobile-link endpoint requires a registered reviewer, non-disabled account,
recent authentication (10 minutes), and is limited to 10 requests per 10 minutes.
It returns a one-time link only for the caller's own email. All API/admin responses
use the existing no-store policy. Firestore client access remains denied.
