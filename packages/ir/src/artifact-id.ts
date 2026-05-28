import { z } from "zod";

export const artifactIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

export type ArtifactId = z.infer<typeof artifactIdSchema>;
