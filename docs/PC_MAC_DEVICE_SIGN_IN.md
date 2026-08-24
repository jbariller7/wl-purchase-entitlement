# PC/Mac device sign-in

WonderLang desktop uses a device-authorization flow so the RPG Maker/NW.js build never contains an OAuth client secret, Firebase Admin credential, Apple key, or long-lived server credential.

## Flow

1. The game calls `POST /api/v1/device-sign-in/start` with a short device label.
2. The server creates a ten-minute session and returns an eight-character user code, a separate 256-bit polling secret, and the `/account/` verification URL.
3. The player opens the verification URL, signs in with Google, Apple, or passwordless email, verifies that the displayed code still matches the game, and explicitly approves it.
4. The game polls `POST /api/v1/device-sign-in/poll` with both the code and polling secret.
5. The server leases token issuance atomically, creates one Firebase custom token for the approved UID, consumes the session, and removes the UID from the consumed document.
6. The desktop client exchanges the custom token with Firebase and uses revocation-checked Firebase ID tokens for WonderLang APIs.

## Security invariants

- Only a hash of the polling secret is stored in Firestore.
- The displayed code is not sufficient to collect a token.
- Unknown codes and incorrect polling secrets return the same error.
- Approval requires a verified Firebase email and a login no older than ten minutes.
- The approval page renders the untrusted device label with `textContent`, not HTML.
- A code can belong to only one UID and can be consumed only once.
- Issuance uses a short transaction lease so concurrent pollers cannot both receive a token.
- Customer/admin session revocation, account disabling, and account deletion remove unclaimed approvals before revoking Firebase sessions.
- Expired anonymous sessions are deleted by a separately controlled scheduled cleanup.
- The public `Origin: null` exception applies only to start/poll, because packaged NW.js pages have an opaque file origin. Authenticated approval still uses the normal WonderLang origin policy.

## Deployment controls

- `DEVICE_SIGN_IN_ENABLED=false` disables start, poll, preview, and approval before Firebase is accessed.
- `DEVICE_SIGN_IN_CLEANUP_ENABLED=false` disables the hourly expired-session cleanup before Firebase is accessed.
- Both controls remain off in the deployed test environment until Firebase Admin credentials are installed and an isolated end-to-end test is authorized.

## Activation gate

1. Install isolated Firebase Admin and web credentials in Netlify.
2. Configure and test Google, Apple, and passwordless email login.
3. Enable only `DEVICE_SIGN_IN_ENABLED` and `DEVICE_SIGN_IN_CLEANUP_ENABLED` in the test deployment.
4. Test pending, approved, canceled, expired, wrong-secret, concurrent-poll, revoke-all, disabled-account, and account-deletion cases.
5. Install the desktop bridge only in a duplicate RPG Maker build.
6. Verify token refresh, offline sign-out, account switching, and API rejection after revocation in the actual NW.js runtime.
7. Keep the production RPG Maker plugin disabled until those tests pass.

The backend and customer approval UI are implemented. The desktop custom-token exchange and real NW.js verification remain release gates.
