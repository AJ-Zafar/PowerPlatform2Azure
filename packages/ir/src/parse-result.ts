import { z } from "zod";

import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";
import { unsupportedFeatureSchema } from "./unsupported-feature";
import { parserWarningSchema } from "./warnings";

export const createParseResultSchema = <T extends z.ZodType>(dataSchema: T) =>
  z
    .object({
      data: dataSchema,
      warnings: z.array(parserWarningSchema),
      unsupported: z.array(unsupportedFeatureSchema),
      confidence: confidenceScoreSchema,
      provenance: sourceProvenanceSchema
    })
    .strict();

export const unknownParseResultSchema = createParseResultSchema(z.unknown());

export type ParseResult<T> = {
  data: T;
  warnings: z.infer<typeof parserWarningSchema>[];
  unsupported: z.infer<typeof unsupportedFeatureSchema>[];
  confidence: z.infer<typeof confidenceScoreSchema>;
  provenance: z.infer<typeof sourceProvenanceSchema>;
};
