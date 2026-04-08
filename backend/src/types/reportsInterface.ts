import { z } from "zod";

// ── Request Body Schemas ──────────────────────────────────────────

export const ReportCreateSchema = z.object({
  latitude: z.number().min(30.22).max(33.22),
  longitude: z.number().min(75.63).max(79.04),
  incident_time: z.string().datetime().nullable().optional(),
  text_content: z.string().max(300).nullable().optional(),
});
export type ReportCreateReq = z.infer<typeof ReportCreateSchema>;

export const MediaUploadUrlSchema = z.object({
  reportId: z.number().int().positive(),
  mediaName: z.string().min(1),
  mimeType: z.string(),
  mediaType: z.enum(["image", "video", "audio"]),
  size: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
});
export type MediaUploadUrlReq = z.infer<typeof MediaUploadUrlSchema>;

export const MediaConfirmUploadSchema = z.object({
  mediaId: z.number().int().positive(),
});
export type MediaConfirmUploadReq = z.infer<typeof MediaConfirmUploadSchema>;

export const ClusterFetchSchema = z.object({
  minLatitude: z.coerce.number(),
  maxLatitude: z.coerce.number(),
  minLongitude: z.coerce.number(),
  maxLongitude: z.coerce.number(),
});
export type ClusterFetchReq = z.infer<typeof ClusterFetchSchema>;

export const ClusterDetailSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ClusterDetailReq = z.infer<typeof ClusterDetailSchema>;


// ── Response Types (Not Zod Validated) ────────────────────────────

export type ReportCreateResponse = {
  reportId: number;
  latitude: number;
  longitude: number;
  incident_time: string | null;
  server_time: string;
  text_content: string | null;
  clusterId: number;
  confidence_score: number;
};

export type MediaUrlResponse = {
  uploadUrl: string;
  mediaId: number;
};

export type MediaConfirmResponse = 
  | { message: string }
  | { mediaId: number; reportId: number };

export type ClusterListResponse = Array<{
  id: number;
  lat: number;
  lon: number;
  report_count: number;
  confidence_score: number;
  last_updated_at: string | null;
  created_at: string;
}>;

export type ClusterDetailResponse = {
  id: number;
  lat: number;
  lon: number;
  report_count: number;
  confidence_score: number;
  last_updated_at: string | null;
  created_at: string;
};
