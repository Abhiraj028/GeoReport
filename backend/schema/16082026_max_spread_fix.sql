-- 1. DROP is_active from clusters
-- Note: is_active is intentionally computed at read-time, not stored.
-- Calculation: (now() - last_confidence_update < 7 days)
ALTER TABLE clusters DROP COLUMN is_active;

-- 3. Add missing indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS idx_reports_cluster_id ON reports(cluster_id);
CREATE INDEX IF NOT EXISTS idx_report_media_report_id ON report_media(report_id);
