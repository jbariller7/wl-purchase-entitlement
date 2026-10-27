export function hasDirectoryFilters(filters) {
  return Boolean(filters.q?.trim()) || ['access', 'cloud', 'platform', 'status'].some(key => filters[key] && filters[key] !== 'all');
}

// Keep each server request bounded, but never make the administrator search
// storage batches manually. An incomplete scan must not look like no matches.
export async function searchDirectory({filters, fetchPage, isCurrent = () => true, onProgress = () => {}}) {
  const rows = [], seen = new Set();
  let cursor = null, scanned = 0;
  do {
    if (!isCurrent()) return null;
    const page = await fetchPage({...filters, ...(cursor ? {cursor} : {})});
    if (!isCurrent()) return null;
    rows.push(...page.rows);
    scanned += page.scanned;
    cursor = page.nextCursor || null;
    if (cursor && seen.has(cursor)) throw new Error('Customer search could not finish. Please retry.');
    if (cursor) seen.add(cursor);
    onProgress({scanned, matches: rows.length});
  } while (cursor);
  return {rows, scanned, nextCursor: null, source: filters.source, completeSearch: true};
}
