import { z } from "zod";

import { artifactIdSchema } from "./artifact-id";
import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";
import { unsupportedFeatureSchema } from "./unsupported-feature";
import { parserWarningSchema } from "./warnings";

export const flowTriggerClassificationSchema = z.enum([
  "recurrence",
  "manual",
  "event",
  "http",
  "dataverse",
  "email",
  "sharepoint",
  "unknown"
]);

export const flowConnectorCategorySchema = z.enum([
  "standard",
  "premium",
  "custom",
  "unknown"
]);

export const flowMigrationReadinessSchema = z.enum(["high", "medium", "low", "blocked"]);

export const flowExpressionReferenceTypeSchema = z.enum([
  "variable",
  "entity",
  "environmentVariable",
  "connectionReference",
  "action",
  "trigger",
  "unknown"
]);

export const flowExpressionReferenceSchema = z
  .object({
    referenceType: flowExpressionReferenceTypeSchema,
    name: z.string().min(1),
    artifactId: artifactIdSchema.optional(),
    resolved: z.boolean()
  })
  .strict();

export const flowExpressionSchema = z
  .object({
    artifactId: artifactIdSchema,
    expressionName: z.string().min(1),
    rawExpression: z.string().min(1),
    references: z.array(flowExpressionReferenceSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowRunAfterDependencySchema = z
  .object({
    actionName: z.string().min(1),
    statuses: z.array(z.string().min(1))
  })
  .strict();

export const flowScopeControlSchema = z
  .object({
    isScope: z.boolean(),
    isCondition: z.boolean(),
    isLoop: z.boolean(),
    hasParallelBranches: z.boolean(),
    branchType: z.string().optional()
  })
  .strict();

export const flowActionChildSchema = z
  .object({
    artifactId: artifactIdSchema,
    actionName: z.string().min(1),
    actionType: z.string().min(1),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowActionSchema = z
  .object({
    artifactId: artifactIdSchema,
    actionName: z.string().min(1),
    actionType: z.string().min(1),
    connectorApi: z.string().optional(),
    connectorCategory: flowConnectorCategorySchema,
    operationId: z.string().optional(),
    runAfter: z.array(flowRunAfterDependencySchema),
    inputs: z.unknown().optional(),
    expressions: z.array(flowExpressionSchema),
    referencedEntities: z.array(z.string().min(1)),
    referencedConnectionReferences: z.array(z.string().min(1)),
    childActions: z.array(flowActionChildSchema),
    scopeControl: flowScopeControlSchema,
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowTriggerSchema = z
  .object({
    artifactId: artifactIdSchema,
    triggerName: z.string().min(1),
    triggerType: z.string().min(1),
    connectorApi: z.string().optional(),
    triggerClassification: flowTriggerClassificationSchema,
    inputs: z.unknown().optional(),
    recurrence: z
      .object({
        frequency: z.string().optional(),
        interval: z.number().optional(),
        schedule: z.unknown().optional(),
        timeZone: z.string().optional()
      })
      .strict()
      .optional(),
    authenticationHint: z.string().optional(),
    expressions: z.array(flowExpressionSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowConnectionSchema = z
  .object({
    artifactId: artifactIdSchema,
    referenceName: z.string().min(1),
    connectorApi: z.string().min(1),
    connectionName: z.string().optional(),
    connectorCategory: flowConnectorCategorySchema,
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowVariableSchema = z
  .object({
    artifactId: artifactIdSchema,
    variableName: z.string().min(1),
    variableType: z.string().min(1),
    initialValue: z.unknown().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const flowDependencyReferenceSchema = z
  .object({
    referenceType: z.enum([
      "connectionReference",
      "entity",
      "environmentVariable",
      "variable",
      "action",
      "trigger",
      "unknown"
    ]),
    referenceName: z.string().min(1),
    artifactId: artifactIdSchema.optional(),
    resolved: z.boolean(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const cloudFlowSchema = z
  .object({
    artifactId: artifactIdSchema,
    flowId: z.string().min(1),
    name: z.string().min(1),
    displayName: z.string().min(1),
    status: z.string().optional(),
    trigger: flowTriggerSchema,
    actions: z.array(flowActionSchema),
    connections: z.array(flowConnectionSchema),
    variables: z.array(flowVariableSchema),
    inputs: z.unknown().optional(),
    outputs: z.unknown().optional(),
    expressions: z.array(flowExpressionSchema),
    dependencyReferences: z.array(flowDependencyReferenceSchema),
    warnings: z.array(parserWarningSchema),
    unsupportedFeatures: z.array(unsupportedFeatureSchema),
    triggerComplexity: confidenceScoreSchema,
    actionComplexity: confidenceScoreSchema,
    connectorComplexity: confidenceScoreSchema,
    expressionComplexity: confidenceScoreSchema,
    controlFlowComplexity: confidenceScoreSchema,
    unsupportedFeatureCount: z.number().int().nonnegative(),
    migrationReadiness: flowMigrationReadinessSchema,
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export type FlowTriggerClassification = z.infer<typeof flowTriggerClassificationSchema>;
export type FlowMigrationReadiness = z.infer<typeof flowMigrationReadinessSchema>;
export type FlowConnectorCategory = z.infer<typeof flowConnectorCategorySchema>;
export type FlowExpressionReferenceType = z.infer<typeof flowExpressionReferenceTypeSchema>;
export type FlowExpressionReference = z.infer<typeof flowExpressionReferenceSchema>;
export type FlowExpression = z.infer<typeof flowExpressionSchema>;
export type FlowRunAfterDependency = z.infer<typeof flowRunAfterDependencySchema>;
export type FlowScopeControl = z.infer<typeof flowScopeControlSchema>;
export type FlowActionChild = z.infer<typeof flowActionChildSchema>;
export type FlowAction = z.infer<typeof flowActionSchema>;
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export type FlowConnection = z.infer<typeof flowConnectionSchema>;
export type FlowVariable = z.infer<typeof flowVariableSchema>;
export type FlowDependencyReference = z.infer<typeof flowDependencyReferenceSchema>;
export type CloudFlow = z.infer<typeof cloudFlowSchema>;
