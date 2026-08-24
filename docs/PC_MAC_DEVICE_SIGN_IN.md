# PC/Mac device sign-in

WonderLang desktop uses a device-authorization flow so the RPG Maker/NW.js build never contains an OAuth client secret, Firebase Admin credential, Apple key, or long-lived server credential.

## Flow

1. The game reads the public Firebase project ID and restricted Web API key from `GET /api/v1/device-sign-in/config`. Netlify supplies both at runtime; neither is embedded in the plugin.
2. The game calls `POST /api/v1/device-sign-in/start` with a short device label.
3. The server creates a ten-minute session and returns an eight-character user code, a separate 256-bit polling secret, and the `/account/` verification URL.
4. The player opens the verification URL, signs in with Google, Apple, or passwordless email, verifies that the displayed code still matches the game, and explicitly approves it.
5. The game polls `POST /api/v1/device-sign-in/poll` with both the code and polling secret.
6. The server leases token issuance atomically, creates one Firebase custom token for the approved UID, consumes the session, and removes the UID from the consumed document.
7. The desktop bridge exchanges the custom token directly with Firebase, validates the returned project audience/issuer, persists only the refresh token in NW.js per-user app data, refreshes expired ID tokens, and retries one API request after a 401 with a freshly issued ID token.

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
- The public `Origin: null` exception applies only to config/start/poll, because packaged NW.js pages have an opaque file origin. Authenticated approval still uses the normal WonderLang origin policy.
- UI events contain only the displayed code, approval URL, expiry and state. The polling secret and custom token never enter an event, URL, log or persistent file.
- `WonderLangDesktopAccountBridge.js` rejects non-HTTPS external URLs and rejects Firebase ID tokens whose audience/issuer do not match the entitlement project.
- Only the refresh token is retained. The file is stored inside NW.js's per-user app-data directory with `0600` permissions on Unix-like systems and the directory's inherited per-user ACL on Windows. The local OS user account remains the desktop storage security boundary.

## Deployment controls

- `DEVICE_SIGN_IN_ENABLED=false` disables start, poll, preview, and approval before Firebase is accessed.
- `DEVICE_SIGN_IN_CLEANUP_ENABLED=false` disables the hourly expired-session cleanup before Firebase is accessed.
- Both controls remain off in the deployed test environment until Firebase Admin credentials are installed and an isolated end-to-end test is authorized.

## Activation gate

1. Install isolated Firebase Admin and web credentials in Netlify.
2. Configure and test Google, Apple, and passwordless email login.
3. Enable only `DEVICE_SIGN_IN_ENABLED` and `DEVICE_SIGN_IN_CLEANUP_ENABLED` in the test deployment.
4. Test pending, approved, canceled, expired, wrong-secret, concurrent-poll, revoke-all, disabled-account, and account-deletion cases.
5. Install `WonderLangDesktopAccountBridge` immediately before `WonderLangAccountCloudSync`, only in a duplicate RPG Maker build.
6. Verify token refresh, offline sign-out, account switching, and API rejection after revocation in the actual NW.js runtime.
7. Keep the production RPG Maker plugin disabled until those tests pass.

The backend, customer approval UI, desktop custom-token exchange, refresh-token rotation, local sign-out deletion and simulated in-game code UI are implemented. Unit tests cover the full mocked exchange/reload/sign-out lifecycle, and the responsive browser harness is verified without console errors. A real Firebase account flow in the actual NW.js runtime remains a release gate.
