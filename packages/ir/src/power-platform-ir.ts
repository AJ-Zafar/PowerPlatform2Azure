import { z } from "zod";

import { artifactIdSchema } from "./artifact-id";
import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";
import { unsupportedFeatureSchema } from "./unsupported-feature";
import { parserWarningSchema } from "./warnings";

const sourceDerivedArtifactSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
    kind: z.string().min(1),
    provenance: sourceProvenanceSchema
  })
  .strict();

const environmentVariableSchema = z
  .object({
    artifactId: artifactIdSchema,
    key: z.string().min(1),
    value: z.string(),
    provenance: sourceProvenanceSchema
  })
  .strict();

const connectionReferenceSchema = z
  .object({
    artifactId: artifactIdSchema,
    connectorName: z.string().min(1),
    connectionName: z.string().min(1),
    provenance: sourceProvenanceSchema
  })
  .strict();

export const solutionMetadataSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    sourceFolder: z.string().min(1),
    provenance: sourceProvenanceSchema
  })
  .strict();

const dataverseSectionSchema = z
  .object({
    entities: z.array(sourceDerivedArtifactSchema),
    relationships: z.array(sourceDerivedArtifactSchema),
    optionSets: z.array(sourceDerivedArtifactSchema)
  })
  .strict();

const securitySectionSchema = z
  .object({
    roles: z.array(sourceDerivedArtifactSchema)
  })
  .strict();

export const powerPlatformIRSchema = z
  .object({
    solution: solutionMetadataSchema,
    dataverse: dataverseSectionSchema,
    canvasApps: z.array(sourceDerivedArtifactSchema),
    cloudFlows: z.array(sourceDerivedArtifactSchema),
    security: securitySectionSchema,
    environmentVariables: z.array(environmentVariableSchema),
    connectionReferences: z.array(connectionReferenceSchema),
    unsupportedFeatures: z.array(unsupportedFeatureSchema),
    warnings: z.array(parserWarningSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export type SolutionMetadata = z.infer<typeof solutionMetadataSchema>;
export type PowerPlatformIR = z.infer<typeof powerPlatformIRSchema>;
