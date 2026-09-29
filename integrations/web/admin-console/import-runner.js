// Every continuation uses the same server-side rows, confirmation and stable external IDs.
export async function runImportBatches({ api, previewId, confirmationPhrase, onProgress, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let failures = 0;
  for (;;) {
    let progress;
    try {
      progress = await api("/admin-api/v1/imports/commit", { method: "POST", body: { previewId, confirmationPhrase, protocolVersion: 2 } });
      failures = 0;
    } catch (error) {
      if (error.status && error.status < 500 && error.status !== 429) throw error;
      if (++failures > 3) throw error;
      await delay(failures * 3000);
      // A lost response is not a failed import. Read durable progress before continuing.
      progress = await api(`/admin-api/v1/imports/${encodeURIComponent(previewId)}`);
    }
    onProgress(progress);
    if (progress.state === "complete") return progress;
    await delay(progress.busy ? 3000 : 600);
  }
}
