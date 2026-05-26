import { z } from "zod";

import { artifactIdSchema } from "./artifact-id";

export const sourceTypeSchema = z.enum([
  "solution",
  "dataverse",
  "canvas",
  "flow",
  "security",
  "environment-variable",
  "connection-reference",
  "parser",
  "cli",
  "unknown"
]);

export const sourceProvenanceSchema = z
  .object({
    sourcePath: z.string().min(1),
    sourceType: sourceTypeSchema,
    artifactId: artifactIdSchema.optional(),
    parserName: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional()
  })
  .strict();

export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;
