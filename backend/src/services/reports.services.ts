/**
 * reports.services.ts
 *
 * All business logic for report creation, media lifecycle, and cluster fetching.
 *
 * Design rules:
 *   - Every transactional operation uses withTransaction(). No manual
 *     BEGIN/COMMIT/ROLLBACK. The callback receives a single PoolClient
 *     that every nested query must use — this structurally prevents the
 *     transaction-visibility bug from the old codebase (a helper querying
 *     via pool while its dependent insert was uncommitted on a different client).
 *   - Pure computation lives in reports.helpers.ts (no DB access there).
 *     Services call helpers with values they already have in scope.
 *   - Decay is a read-time display transform only. It is applied in
 *     reportsFetchService / reportsDetailFetchService right before the
 *     response, and NEVER written back to the DB.
 *   - is_active is NOT a stored/filtered concept. Fetch services include
 *     all clusters; the frontend uses raw timestamps and decayed confidence
 *     to decide what to render.
 */

import { randomUUID } from "crypto";
import { pool, withTransaction } from "../db/db.ts";
import {
  computeConfidence,
  applyDecay,
  computeNewCentroid,
  haversineDistanceMeters,
  advisoryLockKey,
  CLUSTER_SEARCH_RADIUS_METRES,
  MAX_CLUSTER_SPREAD_METRES,
} from "../helpers/reports.helpers.ts";
import type {
  ReportCreateReq,
  ReportCreateResponse,
  MediaUploadUrlReq,
  MediaUrlResponse,
  MediaConfirmResponse,
  ClusterFetchReq,
  ClusterListResponse,
  ClusterDetailResponse,
} from "../types/reportsInterface.ts";
import {
  ReportCreateSchema,
  MediaUploadUrlSchema,
  MediaConfirmUploadSchema,
  ClusterFetchSchema,
  ClusterDetailSchema,
} from "../types/reportsInterface.ts";
import { BadRequestError, InternalServerError } from "../utils/error.classes.ts";
import { getSupabase } from "../db/supabase.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_BUCKET = "reports";
const MAX_MEDIA_PER_REPORT = 5;

// TODO: Read user_trust from the user's actual row instead of hardcoding.
// Currently all anonymous devices start at 0.3 (set in device.middleware.ts),
// so this is correct for V1. Will need to change if user_trust ever becomes
// dynamic or user-specific (e.g. earned trust from report accuracy).
const DEFAULT_USER_TRUST = 0.3;

// ── Private helpers (need DB access — do NOT put these in reports.helpers.ts)

/**
 * Recalculates and writes confidence_score for a cluster after a media
 * confirmation. Uses pool directly — NOT inside a transaction.
 * This is intentional per spec: media confirmation is a standalone
 * read-then-write, not part of the report-creation transaction.
 */
async function mediaConfidenceUpdate(reportId: number): Promise<void> {
  const reportResult = await pool.query(
    "SELECT cluster_id FROM reports WHERE id = $1",
    [reportId]
  );
  const clusterId = reportResult.rows[0]?.cluster_id;
  if (clusterId == null) return; // Report not yet clustered

  const clusterResult = await pool.query(
    "SELECT report_count FROM clusters WHERE id = $1",
    [clusterId]
  );
  const cluster = clusterResult.rows[0];
  if (!cluster) return;

  const mediaResult = await pool.query(
    `SELECT count(*)::int AS cnt FROM report_media
     WHERE status = 'uploaded'
       AND report_id IN (SELECT id FROM reports WHERE cluster_id = $1)`,
    [clusterId]
  );
  const confirmedMediaCount: number = mediaResult.rows[0]?.cnt ?? 0;

  const confidence = computeConfidence(
    DEFAULT_USER_TRUST,
    cluster.report_count,
    confirmedMediaCount
  );

  await pool.query(
    `UPDATE clusters SET confidence_score = $1, last_confidence_update = now()
     WHERE id = $2`,
    [confidence, clusterId]
  );
}

// ── 1. reportCreateService ───────────────────────────────────────────────────

/**
 * Creates a report and attaches it to a cluster (find nearest within 100m, or
 * create a new one). All steps happen inside a single transaction with an
 * advisory lock to prevent concurrent duplicate cluster creation.
 */
export async function reportCreateService(
  body: ReportCreateReq,
  deviceToken: string
): Promise<ReportCreateResponse> {
  const parsed = ReportCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid report data: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  return withTransaction(async (client) => {
    // a. Insert the report.
    //    DB column is `captured_at`; API field is `incident_time`.
    const reportResult = await client.query(
      `INSERT INTO reports (user_token, latitude, longitude, captured_at, text_content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, latitude, longitude, captured_at, created_at, text_content`,
      [
        deviceToken,
        body.latitude,
        body.longitude,
        body.incident_time ?? null,
        body.text_content ?? null,
      ]
    );
    const report = reportResult.rows[0]!;
    const reportId: number = report.id;

    // b. Acquire per-location advisory lock BEFORE the cluster lookup.
    //    Prevents two concurrent reports at the same location from both
    //    creating a new cluster.
    const lockKey = advisoryLockKey(body.latitude, body.longitude);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);

    // c. Find nearby clusters within MAX_CLUSTER_SPREAD_METRES.
    //    No is_active filter — a new report reactivates a dormant hotspot.
    const clusterResult = await client.query(
      `SELECT id, report_count, confidence_score, max_spread,
              ST_X(centroid::geometry) AS lon,
              ST_Y(centroid::geometry) AS lat
         FROM clusters
        WHERE ST_DWithin(
                centroid,
                ST_SetSRID(ST_MakePoint($1, $2), 4326),
                $3
              )
        ORDER BY ST_Distance(
                   centroid,
                   ST_SetSRID(ST_MakePoint($1, $2), 4326)
                 )
        LIMIT 5`,
      [body.longitude, body.latitude, CLUSTER_SEARCH_RADIUS_METRES]
    );

    let clusterId: number;
    let confidenceScore: number;
    let joinExisting = false;
    let existingCluster: any;
    let newCentroid: { lat: number; lon: number; maxSpread: number } | undefined;

    for (const candidate of clusterResult.rows) {
      const computed = computeNewCentroid(
        candidate.lat,
        candidate.lon,
        candidate.report_count,
        body.latitude,
        body.longitude
      );

      // O(n) exact max-spread computation using the same transaction client
      const existingReportsResult = await client.query(
        `SELECT latitude, longitude FROM reports WHERE cluster_id = $1`,
        [candidate.id]
      );

      let maxSpread = 0;
      for (const r of existingReportsResult.rows) {
        const distance = haversineDistanceMeters(
          computed.lat,
          computed.lon,
          Number(r.latitude),
          Number(r.longitude)
        );
        if (distance > maxSpread) maxSpread = distance;
      }

      const newReportDistance = haversineDistanceMeters(
        computed.lat,
        computed.lon,
        body.latitude,
        body.longitude
      );
      if (newReportDistance > maxSpread) maxSpread = newReportDistance;

      if (maxSpread <= MAX_CLUSTER_SPREAD_METRES) {
        joinExisting = true;
        existingCluster = candidate;
        newCentroid = { lat: computed.lat, lon: computed.lon, maxSpread };
        break; // Found our cluster
      }
    }

    if (!joinExisting) {
      // d. No cluster within radius OR joining would exceed spread ceiling — create a new one.
      confidenceScore = computeConfidence(DEFAULT_USER_TRUST, 1, 0);

      const newCluster = await client.query(
        `INSERT INTO clusters
           (centroid, max_spread, report_count, confidence_score,
            last_confidence_update, last_updated_at)
         VALUES
           (ST_SetSRID(ST_MakePoint($1, $2), 4326), 0, 1, $3, now(), now())
         RETURNING id`,
        [body.longitude, body.latitude, confidenceScore]
      );
      clusterId = newCluster.rows[0]!.id;
    } else {
      // e. Cluster found AND spread is within ceiling — update centroid, spread, increment count.
      clusterId = existingCluster.id;

      // First UPDATE: centroid + max_spread + report_count + last_updated_at.
      // RETURNING report_count gives the already-incremented value (H1).
      const updateResult = await client.query(
        `UPDATE clusters
            SET centroid = ST_SetSRID(ST_MakePoint($1, $2), 4326),
                max_spread = $3,
                report_count = report_count + 1,
                last_updated_at = now()
          WHERE id = $4
          RETURNING report_count`,
        [newCentroid!.lon, newCentroid!.lat, newCentroid!.maxSpread, clusterId]
      );
      const newReportCount: number = updateResult.rows[0]!.report_count;

      // Count confirmed media across all reports already in this cluster.
      // This new report has no media yet (media upload is a separate flow
      // that happens after report creation), so this correctly counts only
      // prior reports' confirmed media.
      const mediaCountResult = await client.query(
        `SELECT count(*)::int AS cnt FROM report_media
         WHERE status = 'uploaded'
           AND report_id IN (SELECT id FROM reports WHERE cluster_id = $1)`,
        [clusterId]
      );
      const confirmedMediaCount: number = mediaCountResult.rows[0]!.cnt;

      confidenceScore = computeConfidence(
        DEFAULT_USER_TRUST,
        newReportCount,
        confirmedMediaCount
      );

      // Second UPDATE: confidence_score + last_confidence_update.
      await client.query(
        `UPDATE clusters
            SET confidence_score = $1,
                last_confidence_update = now()
          WHERE id = $2`,
        [confidenceScore, clusterId]
      );
    }

    // f. Link the report to its cluster.
    await client.query(
      "UPDATE reports SET cluster_id = $1 WHERE id = $2",
      [clusterId, reportId]
    );

    console.log("report created", { reportId, clusterId });

    return {
      reportId:         Number(reportId),
      latitude:         Number(report.latitude),
      longitude:        Number(report.longitude),
      incident_time:    report.captured_at?.toISOString() ?? null,
      server_time:      report.created_at.toISOString(),
      text_content:     report.text_content ?? null,
      clusterId:        Number(clusterId),
      confidence_score: confidenceScore,
    };
  });
}

// ── 2. reportMediaCreateService ──────────────────────────────────────────────

/**
 * Creates a pending media row and returns a Supabase signed upload URL.
 * The client uploads directly to Supabase, then calls confirmUpload.
 */
export async function reportMediaCreateService(
  body: MediaUploadUrlReq,
  deviceToken: string
): Promise<MediaUrlResponse> {
  const parsed = MediaUploadUrlSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid media data: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  // Verify the report exists and belongs to this device.
  const ownerCheck = await pool.query(
    "SELECT id FROM reports WHERE id = $1 AND user_token = $2",
    [body.reportId, deviceToken]
  );
  if (!ownerCheck.rowCount || ownerCheck.rowCount === 0) {
    throw new BadRequestError("Report not found or access denied");
  }

  // 5-attachment cap: counts ALL statuses (pending + uploaded).
  // Different from the confirmed-only count used in confidence calculations.
  const countResult = await pool.query(
    "SELECT count(*)::int AS cnt FROM report_media WHERE report_id = $1",
    [body.reportId]
  );
  if ((countResult.rows[0]?.cnt ?? 0) >= MAX_MEDIA_PER_REPORT) {
    throw new BadRequestError(
      "Maximum media attachments reached for this report"
    );
  }

  // Storage path within the Supabase bucket.
  const storagePath = `reports/${body.reportId}/${randomUUID()}-${body.mediaName}`;

  // Schema doesn't have a media_name column — store it in metadata JSONB
  // alongside the other optional fields the client provides.
  const metadata = {
    mediaName: body.mediaName,
    mimeType:  body.mimeType,
    ...(body.size     != null && { size:     body.size }),
    ...(body.height   != null && { height:   body.height }),
    ...(body.width    != null && { width:    body.width }),
    ...(body.duration != null && { duration: body.duration }),
  };

  const insertResult = await pool.query(
    `INSERT INTO report_media (report_id, media_url, media_type, metadata, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [body.reportId, storagePath, body.mediaType, JSON.stringify(metadata)]
  );
  const mediaId: number = insertResult.rows[0]!.id;

  // Request a signed upload URL from Supabase storage.
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    // Clean up the pending row — don't leave orphaned media records.
    await pool.query("DELETE FROM report_media WHERE id = $1", [mediaId]);
    throw new InternalServerError("Failed to create signed upload URL");
  }

  console.log("media created", { mediaId, reportId: body.reportId });

  return {
    uploadUrl: data.signedUrl,
    mediaId,
  };
}

// ── 3. reportMediaConfirmService ─────────────────────────────────────────────

/**
 * Transitions a media row from pending → uploaded and recalculates the
 * cluster's confidence score.
 *
 * Known gap (V1): we trust the confirm request at face value.
 * In a future version, verify the object actually exists in Supabase
 * storage before flipping status. Without verification, a client could
 * fake a confirm call and inflate confidence scores for empty media.
 */
export async function reportMediaConfirmService(
  mediaId: number,
  deviceToken: string
): Promise<MediaConfirmResponse> {
  const parsed = MediaConfirmUploadSchema.safeParse({ mediaId });
  if (!parsed.success) {
    throw new BadRequestError(`Invalid media confirmation data: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  // Attempt atomic transition: pending → uploaded, with ownership check.
  const updateResult = await pool.query(
    `UPDATE report_media rm
        SET status = 'uploaded'
       FROM reports r
      WHERE rm.report_id = r.id
        AND rm.id = $1
        AND r.user_token = $2
        AND rm.status = 'pending'
      RETURNING rm.id, rm.report_id`,
    [mediaId, deviceToken]
  );

  if (updateResult.rowCount && updateResult.rowCount > 0) {
    const row = updateResult.rows[0]!;
    const reportId: number = row.report_id;

    // Recalculate cluster confidence with the new confirmed media.
    await mediaConfidenceUpdate(reportId);

    console.log("media confirmed", { mediaId, reportId });
    return { mediaId, reportId };
  }

  // 0 rows updated — figure out why.
  const checkResult = await pool.query(
    `SELECT rm.status
       FROM report_media rm
       JOIN reports r ON rm.report_id = r.id
      WHERE rm.id = $1 AND r.user_token = $2`,
    [mediaId, deviceToken]
  );

  if (!checkResult.rowCount || checkResult.rowCount === 0) {
    throw new BadRequestError("Media not found");
  }

  if (checkResult.rows[0]!.status === "uploaded") {
    return { message: "Media already confirmed" };
  }

  throw new BadRequestError(
    "Media not in a confirmable state or access denied"
  );
}

// ── 4. reportsFetchService ───────────────────────────────────────────────────

/**
 * Returns clusters whose centroid falls within the given bounding box.
 * Confidence scores are decayed at read time — never written back.
 * No is_active filter; the frontend decides what to render based on
 * raw timestamps and decayed confidence.
 */
export async function reportsFetchService(
  query: ClusterFetchReq
): Promise<ClusterListResponse> {
  const parsed = ClusterFetchSchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid fetch query parameters: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  const result = await pool.query(
    `SELECT id,
            ST_Y(centroid::geometry) AS lat,
            ST_X(centroid::geometry) AS lon,
            report_count,
            confidence_score,
            last_confidence_update,
            last_updated_at,
            created_at
       FROM clusters
      WHERE centroid::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
    [query.minLongitude, query.minLatitude, query.maxLongitude, query.maxLatitude]
  );

  return result.rows.map((row) => ({
    id:               Number(row.id),
    lat:              Number(row.lat),
    lon:              Number(row.lon),
    report_count:     row.report_count,
    confidence_score: row.last_confidence_update
      ? applyDecay(row.confidence_score, row.last_confidence_update)
      : row.confidence_score,
    last_updated_at:  row.last_updated_at?.toISOString() ?? null,
    created_at:       row.created_at.toISOString(),
  }));
}

// ── 5. reportsDetailFetchService ─────────────────────────────────────────────

/**
 * Returns a single cluster by ID with decayed confidence.
 */
export async function reportsDetailFetchService(
  clusterId: number
): Promise<ClusterDetailResponse> {
  const parsed = ClusterDetailSchema.safeParse({ id: clusterId });
  if (!parsed.success) {
    throw new BadRequestError(`Invalid cluster ID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  const result = await pool.query(
    `SELECT id,
            ST_Y(centroid::geometry) AS lat,
            ST_X(centroid::geometry) AS lon,
            report_count,
            confidence_score,
            last_confidence_update,
            last_updated_at,
            created_at
       FROM clusters
      WHERE id = $1`,
    [clusterId]
  );

  if (!result.rowCount || result.rowCount === 0) {
    throw new BadRequestError("Cluster not found");
  }

  const row = result.rows[0]!;

  return {
    id:               Number(row.id),
    lat:              Number(row.lat),
    lon:              Number(row.lon),
    report_count:     row.report_count,
    confidence_score: row.last_confidence_update
      ? applyDecay(row.confidence_score, row.last_confidence_update)
      : row.confidence_score,
    last_updated_at:  row.last_updated_at?.toISOString() ?? null,
    created_at:       row.created_at.toISOString(),
  };
}
