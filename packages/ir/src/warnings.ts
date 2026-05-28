import { z } from "zod";

import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";

export const parserWarningSeveritySchema = z.enum(["info", "warning", "error"]);

export const parserWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: parserWarningSeveritySchema,
    sourceLocation: z.string().min(1),
    confidence: confidenceScoreSchema,
    provenance: sourceProvenanceSchema
  })
  .strict();

export type ParserWarning = z.infer<typeof parserWarningSchema>;

export interface CreateWarningInput {
  code: string;
  message: string;
  sourceLocation: string;
  provenance: z.infer<typeof sourceProvenanceSchema>;
  severity?: z.infer<typeof parserWarningSeveritySchema>;
  confidence?: z.infer<typeof confidenceScoreSchema>;
}

export const createWarning = (input: CreateWarningInput): ParserWarning =>
  parserWarningSchema.parse({
    severity: "warning",
    confidence: 0.5,
    ...input
  });
