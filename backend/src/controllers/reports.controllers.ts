import type { Request, Response } from "express";
import {
  reportCreateService,
  reportMediaCreateService,
  reportMediaConfirmService,
  reportsFetchService,
  reportsDetailFetchService,
} from "../services/reports.services.ts";
import type {
  ReportCreateReq,
  MediaUploadUrlReq,
  ClusterFetchReq,
} from "../types/reportsInterface.ts";

export const reportCreator = async (
  req: Request,
  res: Response
): Promise<void> => {
  const deviceToken = req.deviceToken as string;
  const body = req.body as ReportCreateReq;
  const result = await reportCreateService(body, deviceToken);
  res.status(200).json({ data: result });
};

export const reportMediaUrlCreator = async (
  req: Request,
  res: Response
): Promise<void> => {
  const deviceToken = req.deviceToken as string;
  const body = req.body as MediaUploadUrlReq;
  const result = await reportMediaCreateService(body, deviceToken);
  res.status(200).json({ data: result });
};

export const reportMediaConfirm = async (
  req: Request,
  res: Response
): Promise<void> => {
  const deviceToken = req.deviceToken as string;
  // Zod inside the service validates mediaId; we just pass it through.
  const mediaId = req.body.mediaId;
  const result = await reportMediaConfirmService(mediaId, deviceToken);
  res.status(200).json({ data: result });
};

export const reportsFetch = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Query parameters are typed as ClusterFetchReq, parsed correctly via z.coerce inside the service.
  const query = req.query as unknown as ClusterFetchReq;
  const result = await reportsFetchService(query);
  res.status(200).json({ data: result });
};

export const reportsDetailFetch = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = Number(req.params.id);
  // Note: trackDevice runs on this route and bumps last_seen_at for activity tracking,
  // but req.deviceToken is not currently consumed here (no ownership-based display yet).
  const result = await reportsDetailFetchService(id);
  res.status(200).json({ data: result });
};
