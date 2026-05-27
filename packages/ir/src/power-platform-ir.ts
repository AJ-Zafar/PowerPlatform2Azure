import { z } from "zod";

import { artifactIdSchema } from "./artifact-id";
import { canvasAppSchema } from "./canvas";
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
    entityLogicalName: z.string().min(1).optional(),
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

export const dependencyTypeSchema = z.enum([
  "solution-entity",
  "solution-workflow",
  "solution-canvas-app",
  "canvas-app-screen",
  "screen-control",
  "control-child-control",
  "control-data-source",
  "formula-data-source",
  "formula-variable",
  "formula-collection",
  "navigate-target-screen",
  "formula-target-table",
  "entity-attribute",
  "entity-relationship",
  "relationship-target-entity",
  "flow-connection-reference",
  "environment-variable-dependent-artifact",
  "security-role-entity-privilege"
]);

export const dependencyEdgeSchema = z
  .object({
    sourceArtifactId: artifactIdSchema,
    targetArtifactId: artifactIdSchema,
    dependencyType: dependencyTypeSchema,
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema,
    resolved: z.boolean(),
    unresolvedWarning: z.string().min(1).optional()
  })
  .strict();

export const dependencyGraphSchema = z
  .object({
    edges: z.array(dependencyEdgeSchema)
  })
  .strict();

export const analysisSummarySchema = z
  .object({
    filesScanned: z.number().int().nonnegative(),
    classifiedFiles: z.number().int().nonnegative(),
    unknownFiles: z.number().int().nonnegative(),
    solutionMetadataPresence: z.boolean(),
    entities: z.number().int().nonnegative(),
    attributes: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    choices: z.number().int().nonnegative(),
    canvasApps: z.number().int().nonnegative(),
    canvasScreens: z.number().int().nonnegative(),
    canvasControls: z.number().int().nonnegative(),
    canvasFormulas: z.number().int().nonnegative(),
    environmentVariables: z.number().int().nonnegative(),
    connectionReferences: z.number().int().nonnegative(),
    securityRoles: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    unsupportedFeatures: z.number().int().nonnegative(),
    unresolvedDependencies: z.number().int().nonnegative()
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
    canvasApps: z.array(canvasAppSchema),
    cloudFlows: z.array(sourceDerivedArtifactSchema),
    security: securitySectionSchema,
    environmentVariables: z.array(environmentVariableSchema),
    connectionReferences: z.array(connectionReferenceSchema),
    dependencyGraph: dependencyGraphSchema,
    analysisSummary: analysisSummarySchema,
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
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
export type DependencyGraph = z.infer<typeof dependencyGraphSchema>;
export type AnalysisSummary = z.infer<typeof analysisSummarySchema>;
