# Cloud storage monitoring runbook

The Admin console needs to show total cloud-save storage, daily growth, and expired staging uploads without exposing customer object paths.

## What is measured

The scheduled monitor inventories exactly two server-only prefixes:

- `cloud-saves/`: finalized immutable save revisions.
- `cloud-save-uploads/`: temporary signed-upload targets.

It stores only aggregate object counts and bytes. A staging object whose provider `updated` time is more than 24 hours old is counted as stale. The daily change compares the current total with the latest prior dated snapshot. No UID, bucket path, save slot, hash, or object metadata is stored in the snapshot.

Provider/storage errors can contain UID-bearing paths, so failure records deliberately contain only a generic diagnostic. Use the Netlify function status and Firebase IAM/billing consoles for deeper investigation.

## Deployment controls

- `CLOUD_STORAGE_MONITORING_ENABLED=false` is the fail-closed default.
- `CLOUD_STORAGE_DAILY_GROWTH_ALERT_BYTES=524288000` sets a default 500 MiB daily-growth warning threshold.
- Netlify checks once daily at 02:43 UTC.

The monitor only lists Storage objects and writes aggregate Firestore metrics. It never reads save contents and never deletes an object.

## Staging activation

1. Provision the Firebase staging bucket and deploy the deny-by-default Storage rules/CORS policy.
2. Confirm the Firebase Admin service account has only the bucket-list/metadata permissions needed by the monitor plus the separate cloud-save API permissions.
3. Keep every purchase, webhook, fulfillment, advertising and deletion switch off.
4. Enable only `CLOUD_STORAGE_MONITORING_ENABLED` in the test deploy.
5. Verify Admin → Overview shows Cloud storage and Admin → Operations shows revision, staging and daily-change rows.
6. Seed one expired test staging object and verify a stale-upload alert without exposing its path.
7. Disable monitoring again if the bucket or IAM configuration changes.

The monitor reports stale uploads; it does not delete them. Garbage-collection retention and deletion require a separately approved policy and implementation.
