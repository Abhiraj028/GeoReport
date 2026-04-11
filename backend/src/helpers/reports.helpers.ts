/**
 * reports.helpers.ts
 *
 * Pure, synchronous, DB-free math functions for the report/cluster pipeline.
 *
 * Design contract (DO NOT VIOLATE):
 *   - No DB access inside any function. Callers query what they need inside
 *     their transaction and pass plain values in. This eliminates the
 *     transaction-visibility bug where a pool-level query couldn't see rows
 *     still uncommitted on a transaction client.
 *   - All functions are trivially unit-testable with no mocking.
 *   - Decay is a read-time display transform only — it is NEVER written back
 *     to the DB. clusters.confidence_score always stores the undecayed value.
 *
 * Cluster invariants (enforced in services, documented here for reference):
 *   - Cluster search radius: 100 m via PostGIS ST_DWithin.
 *   - Advisory lock: pg_advisory_xact_lock(hashtext(advisoryLockKey(lat, lon)))
 *     acquired inside the transaction before the cluster lookup, preventing
 *     concurrent reports at the same location from racing into duplicate clusters.
 *   - is_active is NOT written by services. Fetch services compute it inline:
 *     is_active = (now - last_confidence_update) < 7 days. No background job.
 */

export const DECAY_HALF_LIFE_HOURS = 12;
export const CLUSTER_ACTIVE_THRESHOLD_HOURS = 7 * 24; // 7 days
// Search radius — how far from a new report's coordinates we look for candidate
// clusters via ST_DWithin. Must be WIDER than MAX_CLUSTER_SPREAD_METRES so that
// candidates near the edge can be found and then rejected by the spread ceiling.
export const CLUSTER_SEARCH_RADIUS_METRES = 100;

// Spread ceiling — the maximum allowed distance from a cluster's centroid to its
// farthest member report. Guarantees cluster footprint never exceeds 100m diameter.
// Checked AFTER the O(n) exact max-spread recomputation; candidates that would
// exceed this are skipped even if they're within the search radius.
export const MAX_CLUSTER_SPREAD_METRES = 50;

// ── Advisory lock key ────────────────────────────────────────────────────────

/**
 * Derives a stable string key for the per-location PostgreSQL advisory lock.
 * Rounds to 3 decimal places (~111 m grid), so all reports within a ~111 m cell
 * contend on the same lock — coarse enough to be effective, fine enough not to
 * be a bottleneck.
 *
 * Usage in service (inside a transaction client `c`):
 *   await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [advisoryLockKey(lat, lon)]);
 */
export function advisoryLockKey(lat: number, lon: number): string {
  return `${Math.round(lat * 1000)}:${Math.round(lon * 1000)}`;
}

// ── 1. computeConfidence ─────────────────────────────────────────────────────

/**
 * Computes the UNDECAYED confidence score for a cluster after a new report.
 *
 * Formula:
 *   base       = 1 - (1 - userTrust) ** reportCount
 *   mediaBonus = 1 - (1 - 0.35)     ** confirmedMediaCount
 *   return       base + (1 - base) * mediaBonus
 *
 * Properties:
 *   - Saturates toward 1.0 as reportCount grows (regardless of userTrust).
 *   - Each confirmed media upload fills in a fraction of the remaining gap
 *     between current confidence and 1.0 (diminishing returns).
 *   - Returns 0.0 when reportCount === 0 and confirmedMediaCount === 0.
 *
 * @param userTrust            Submitting user's trust score [0.0, 1.0].
 * @param reportCount          Total confirmed reports on this cluster AFTER
 *                             the current insert (i.e. already incremented).
 * @param confirmedMediaCount  Count of report_media rows with status = 'uploaded'
 *                             across all reports on this cluster. Caller must
 *                             filter to uploaded only — pending/failed must not
 *                             be counted.
 */
export function computeConfidence(
  userTrust: number,
  reportCount: number,
  confirmedMediaCount: number
): number {
  const base       = 1 - (1 - userTrust) ** reportCount;
  const mediaBonus = 1 - (1 - 0.35)     ** confirmedMediaCount;
  return base + (1 - base) * mediaBonus;
}

// ── 2. applyDecay ────────────────────────────────────────────────────────────

/**
 * Applies time-based exponential decay to a stored confidence score.
 *
 * Formula:
 *   hours = (now - lastConfidenceUpdate) in hours
 *   decay = exp(-hours / DECAY_HALF_LIFE_HOURS)   // 12-hour half-life
 *   return confidenceScore * decay
 *
 * IMPORTANT — call sites:
 *   Only call this inside reportsFetchService and reportsDetailFetchService,
 *   immediately before the value goes into the response object.
 *   NEVER write the decayed value back to clusters.confidence_score.
 *   NEVER call this anywhere in a write path.
 *
 * @param confidenceScore       The stored (undecayed) value from the DB.
 * @param lastConfidenceUpdate  When the stored score was last computed.
 */
export function applyDecay(
  confidenceScore: number,
  lastConfidenceUpdate: Date
): number {
  const nowMs              = Date.now();
  const lastMs             = lastConfidenceUpdate.getTime();
  const hoursSinceUpdate   = (nowMs - lastMs) / (1000 * 60 * 60);
  const decay              = Math.exp(-hoursSinceUpdate / DECAY_HALF_LIFE_HOURS);
  return confidenceScore * decay;
}

// ── 3. computeNewCentroid ────────────────────────────────────────────────────

/**
 * Updates a cluster's centroid using an incremental running mean.
 *
 * Formula:
 *   newLat = (oldLat * oldReportCount + newLat) / (oldReportCount + 1)
 *   newLon = (oldLon * oldReportCount + newLon) / (oldReportCount + 1)
 *
 * Used only in the "cluster already exists" path (within-100m match).
 * Without this, a long-lived cluster's centroid stays frozen at its first
 * report's coordinates forever, which is wrong when activity drifts within
 * the capture radius over time.
 *
 * @param oldLat          Current cluster centroid latitude.
 * @param oldLon          Current cluster centroid longitude.
 * @param oldReportCount  Report count BEFORE the current insert.
 *                        (Not yet incremented — the formula handles +1.)
 * @param newLat          Incoming report latitude.
 * @param newLon          Incoming report longitude.
 */
export function computeNewCentroid(
  oldLat: number,
  oldLon: number,
  oldReportCount: number,
  newLat: number,
  newLon: number
): { lat: number; lon: number } {
  const n = oldReportCount + 1;
  const lat = (oldLat * oldReportCount + newLat) / n;
  const lon = (oldLon * oldReportCount + newLon) / n;

  return { lat, lon };
}

export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
