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
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const localizedLabelSchema = z
  .object({
    languageCode: z.string().min(1),
    value: z.string().min(1)
  })
  .strict();

const solutionPublisherSchema = z
  .object({
    uniqueName: z.string().min(1),
    displayName: z.string().min(1)
  })
  .strict();

export const dataverseAttributeTypeSchema = z.enum([
  "string",
  "memo",
  "integer",
  "decimal",
  "float",
  "money",
  "boolean",
  "datetime",
  "lookup",
  "picklist",
  "multiselectpicklist",
  "owner",
  "state",
  "status",
  "uniqueidentifier",
  "unknown"
]);

const dataverseRequiredLevelSchema = z.enum([
  "none",
  "recommended",
  "applicationRequired",
  "systemRequired"
]);

export const dataverseAttributeSchema = z
  .object({
    artifactId: artifactIdSchema,
    entityArtifactId: artifactIdSchema,
    logicalName: z.string().min(1),
    schemaName: z.string().min(1),
    type: dataverseAttributeTypeSchema,
    requiredLevel: dataverseRequiredLevelSchema,
    maxLength: z.number().int().positive().optional(),
    precision: z.number().optional(),
    scale: z.number().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const dataverseEntitySchema = z
  .object({
    artifactId: artifactIdSchema,
    logicalName: z.string().min(1),
    schemaName: z.string().min(1),
    displayName: z.string().min(1),
    ownershipType: z.string().min(1),
    primaryNameAttribute: z.string().min(1),
    primaryIdAttribute: z.string().min(1),
    attributes: z.array(dataverseAttributeSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const dataverseRelationshipSchema = z
  .object({
    artifactId: artifactIdSchema,
    schemaName: z.string().min(1),
    relationshipType: z.enum(["one-to-many", "many-to-one", "many-to-many"]),
    fromEntityLogicalName: z.string().min(1),
    toEntityLogicalName: z.string().min(1),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const dataverseChoiceOptionSchema = z
  .object({
    value: z.number().int(),
    label: z.string().min(1)
  })
  .strict();

export const dataverseOptionSetSchema = z
  .object({
    artifactId: artifactIdSchema,
    logicalName: z.string().min(1),
    isGlobal: z.boolean(),
    options: z.array(dataverseChoiceOptionSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const environmentVariableSchema = z
  .object({
    artifactId: artifactIdSchema,
    schemaName: z.string().min(1),
    type: z.string().min(1),
    defaultValue: z.string().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const connectionReferenceSchema = z
  .object({
    artifactId: artifactIdSchema,
    logicalName: z.string().min(1),
    connectorType: z.string().min(1),
    connectionMetadata: z.string().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const securityPrivilegeSchema = z
  .object({
    privilegeName: z.string().min(1),
    scope: z.string().min(1),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const securityRoleSchema = z
  .object({
    artifactId: artifactIdSchema,
    roleName: z.string().min(1),
    privileges: z.array(securityPrivilegeSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const solutionMetadataSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
    uniqueName: z.string().min(1),
    version: z.string().min(1),
    sourceFolder: z.string().min(1),
    publisher: solutionPublisherSchema,
    managed: z.boolean(),
    localizedNames: z.array(localizedLabelSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const dataverseSectionSchema = z
  .object({
    entities: z.array(dataverseEntitySchema),
    relationships: z.array(dataverseRelationshipSchema),
    optionSets: z.array(dataverseOptionSetSchema)
  })
  .strict();

const securitySectionSchema = z
  .object({
    roles: z.array(securityRoleSchema)
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
export type DataverseEntity = z.infer<typeof dataverseEntitySchema>;
export type DataverseAttribute = z.infer<typeof dataverseAttributeSchema>;
export type DataverseRelationship = z.infer<typeof dataverseRelationshipSchema>;
export type DataverseOptionSet = z.infer<typeof dataverseOptionSetSchema>;
export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
export type ConnectionReference = z.infer<typeof connectionReferenceSchema>;
export type SecurityRole = z.infer<typeof securityRoleSchema>;
