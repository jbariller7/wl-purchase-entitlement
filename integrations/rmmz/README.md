# RPG Maker MZ duplicate integration

`WonderLangAccountCloudSync.js` is a new standalone plugin, not a modification of the live project. It keeps every local save authoritative first, uploads only after local success, validates SHA-256 in both directions, retains revision IDs, and never deletes cloud data when access lapses.

Its duplicate-build default is the isolated `https://wl-purchase-entitlement.netlify.app` test service. Production builds must override `ApiBaseUrl` deliberately during the release cutover; never point a test build back at `purchased-keys-automation`.

The paywall duplicate should merge ownership as follows:

```js
const nativeOwned = isDirectProductPurchased(sku);
const accountOwned = window.WLAccountEntitlements?.isProductPurchased(sku) === true;
return nativeOwned || accountOwned;
```

Existing chapter and `wonderlangfull` purchases must still be queried/restored. The new storefront may stop selling chapter SKUs, but it must not stop honoring them.

Do not auto-restore a remote slot over a different local slot. Present the timestamps/revisions and ask the player which copy to keep when the backend returns HTTP 409.
