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
- `CLOUD_SAVE_CLEANUP_ENABLED=false` independently controls the obsolete-revision deletion worker.
- `CLOUD_STORAGE_DAILY_GROWTH_ALERT_BYTES=524288000` sets a default 500 MiB daily-growth warning threshold.
- Netlify checks once daily at 02:43 UTC.

The monitor only lists Storage objects and writes aggregate Firestore metrics. It never reads save contents and never deletes an object. The separate cleanup worker accepts only exact immutable paths under `cloud-saves/{uid}/slots/save0..save20/revisions/{uuid}.json`, binds every path to the job UID, and uses leases and exponential retry. Admin receives queue counts plus sanitized terminal-failure rows; it can audit and requeue a failed job without receiving the UID or object path.

## Staging activation

1. Provision the Firebase staging bucket and deploy the deny-by-default Storage rules/CORS policy.
2. Inspect the bucket's existing lifecycle configuration. Merge it if necessary, then apply `storage.lifecycle.json` with `gcloud storage buckets update gs://BUCKET_NAME --lifecycle-file=storage.lifecycle.json`. It deletes only abandoned `cloud-save-uploads/` and `cloud-save-profile-uploads/` staging objects after one day; retained profile revisions are excluded.
3. Confirm the Firebase Admin service account has only the bucket-list/metadata permissions needed by the monitor plus the separate cloud-save API permissions.
4. Keep every purchase, webhook, fulfillment, advertising and account-deletion switch off.
5. Enable only `CLOUD_STORAGE_MONITORING_ENABLED` in the test deploy.
6. Verify Admin → Overview shows Cloud storage and Admin → Operations shows revision, staging, daily-change and revision-cleanup queue rows.
7. Seed one expired test staging object and verify a stale-upload alert without exposing its path.
8. In test only, enable `CLOUD_SAVE_CLEANUP_ENABLED`; upload enough revisions to one slot to prune an older object and verify the queue drains. Temporarily deny deletion to verify retry and aggregate failure visibility without object paths.
9. Disable either control again if the bucket or IAM configuration changes.

The monitor reports stale uploads; bucket lifecycle management deletes abandoned staging objects. Finalization and the separate worker delete only immutable revisions that have already fallen outside the current-plus-three retained history.
