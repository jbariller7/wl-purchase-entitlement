# Resumable administrator imports

The old commit endpoint applied up to 500 rows in one synchronous request. A gateway timeout could leave a partially applied import marked processing, without a row cursor. Retrying in the UI could not recover it.

The replacement processes at most five rows per call with an eight-second soft budget. Each successful row saves its cursor and applied/pending counts. A two-minute lease prevents overlapping requests; a timed-out worker can be recovered after its lease expires. Recovery reuses the original normalized rows, start dates and external IDs. Existing grant and pending-import identifiers remain stable, so a lost checkpoint can replay a row without creating a second grant or pending row. Completed imports return their stored result, and completion plus its deterministic audit record are written atomically.

Unconfirmed previews still expire after 30 minutes. Previously confirmed imports remain resumable after that deadline, including legacy processing/failed imports. Legacy progress is explicitly shown as unknown until recovery starts. Only the original administrator can inspect or resume a batch.

The Imports section now lists the twenty most recent stored previews (filtered to the current administrator), displays progress and completion counts, and offers Resume for started jobs or typed confirmation for unstarted previews. The browser continues automatically while open and checks server progress after transient request failures. Closing the browser pauses continuation until Resume is selected. The updated commit protocol rejects old loaded clients with a reload/resume message rather than letting them mislabel a partial response as complete.

Preview identity checks use Firebase batches of 100 identifiers instead of up to 500 parallel calls. Import continuation has its own rate limit; refund/price commit limits are unchanged.

Validation: regression tests cover chunking, lost checkpoints, replay identifiers, stale legacy requests, leases, expiry, ownership, authentication failures, 500-row preview lookup and browser recovery after 504. The local simulated admin UI was exercised from CSV validation through confirmation and completion. No fictional test records were submitted to production.
