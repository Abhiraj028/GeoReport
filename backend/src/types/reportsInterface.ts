import z from "../utils/zodInit";

export const ReportReqBodySchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    
    captured_at: z.iso.datetime(),
    text_content: z.string().max(200).optional()
});
export type ReportReqBody = z.infer<typeof ReportReqBodySchema>;

export const ReportResponseSchema = z.object({
    id: z.number(),
    latitude: z.number(),
    longitude: z.number(),

    captured_at: z.iso.datetime(),
    created_at: z.iso.datetime()
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;