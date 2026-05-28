import { z } from "zod";

import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";

export const unsupportedFeatureSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
]);

export const unsupportedFeatureSchema = z
  .object({
    featureType: z.string().min(1),
    sourceLocation: z.string().min(1),
    reason: z.string().min(1),
    suggestedRemediation: z.string().min(1),
    severity: unsupportedFeatureSeveritySchema,
    confidence: confidenceScoreSchema,
    provenance: sourceProvenanceSchema
  })
  .strict();

export type UnsupportedFeature = z.infer<typeof unsupportedFeatureSchema>;

export interface CreateUnsupportedFeatureInput {
  featureType: string;
  sourceLocation: string;
  reason: string;
  suggestedRemediation: string;
  severity: z.infer<typeof unsupportedFeatureSeveritySchema>;
  confidence: z.infer<typeof confidenceScoreSchema>;
  provenance: z.infer<typeof sourceProvenanceSchema>;
}

export const createUnsupportedFeature = (
  input: CreateUnsupportedFeatureInput
): UnsupportedFeature => unsupportedFeatureSchema.parse(input);
