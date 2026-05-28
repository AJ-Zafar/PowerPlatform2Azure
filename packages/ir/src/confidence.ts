import { z } from "zod";

export const confidenceScoreSchema = z.number().min(0).max(1);

export type ConfidenceScore = z.infer<typeof confidenceScoreSchema>;
