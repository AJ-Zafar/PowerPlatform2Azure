import { z } from "zod";

import {
  artifactIdSchema,
  confidenceScoreSchema,
  sourceProvenanceSchema,
  unsupportedFeatureSeveritySchema,
  parserWarningSeveritySchema
} from "@power-exit/ir";

export const generatorCapabilitySchema = z.enum([
  "ir-json",
  "assessment-report-markdown",
  "azure-sql-ddl",
  "react-screen-skeleton",
  "azure-functions-scaffold",
  "azure-infra-bicep-scaffold"
]);

export type GeneratorCapability = z.infer<typeof generatorCapabilitySchema>;

const generatorIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const generatorContextSchema = z
  .object({
    invocationProvenance: sourceProvenanceSchema,
    outputFolder: z.string().min(1).optional()
  })
  .strict();

export type GeneratorContext = z.infer<typeof generatorContextSchema>;

export const generationWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: parserWarningSeveritySchema,
    confidence: confidenceScoreSchema,
    sourceArtifactIds: z.array(artifactIdSchema),
    sourceLocation: z.string().min(1),
    provenance: sourceProvenanceSchema
  })
  .strict();

export type GenerationWarning = z.infer<typeof generationWarningSchema>;

export const generationUnsupportedFeatureSchema = z
  .object({
    featureType: z.string().min(1),
    sourceLocation: z.string().min(1),
    reason: z.string().min(1),
    suggestedRemediation: z.string().min(1),
    severity: unsupportedFeatureSeveritySchema,
    confidence: confidenceScoreSchema,
    sourceArtifactIds: z.array(artifactIdSchema),
    provenance: sourceProvenanceSchema
  })
  .strict();

export type GenerationUnsupportedFeature = z.infer<typeof generationUnsupportedFeatureSchema>;

export const generatedArtifactSchema = z
  .object({
    artifactId: artifactIdSchema,
    artifactType: z.string().min(1),
    filePath: z.string().min(1),
    content: z.string(),
    sourceArtifactIds: z.array(artifactIdSchema),
    warnings: z.array(generationWarningSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export type GeneratedArtifact = z.infer<typeof generatedArtifactSchema>;

export const generationPlanActionSchema = z.enum([
  "create",
  "overwrite",
  "skip",
  "unchanged"
]);

export type GenerationPlanAction = z.infer<typeof generationPlanActionSchema>;

export const generationPlanFileWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export type GenerationPlanFileWarning = z.infer<typeof generationPlanFileWarningSchema>;

export const generationPlannedFileSchema = z
  .object({
    path: z.string().min(1),
    artifactType: z.string().min(1),
    sourceArtifactIds: z.array(artifactIdSchema),
    action: generationPlanActionSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    confidence: confidenceScoreSchema,
    warnings: z.array(generationPlanFileWarningSchema)
  })
  .strict();

export type GenerationPlannedFile = z.infer<typeof generationPlannedFileSchema>;

export const generationSkippedFileSchema = z
  .object({
    path: z.string().min(1),
    reason: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type GenerationSkippedFile = z.infer<typeof generationSkippedFileSchema>;

export const generationOverwrittenFileSchema = z
  .object({
    path: z.string().min(1),
    previousContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    nextContentHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type GenerationOverwrittenFile = z.infer<typeof generationOverwrittenFileSchema>;

export const generationFormulaHotspotSchema = z
  .object({
    screen: z.string().min(1),
    control: z.string().min(1).nullable(),
    property: z.string().min(1),
    formulaBucket: z.string().min(1),
    originalPowerFx: z.string().min(1),
    generatedStubName: z.string().min(1),
    likelyManualImplementationArea: z.string().min(1),
    severity: unsupportedFeatureSeveritySchema,
    recommendation: z.string().min(1)
  })
  .strict();

export type GenerationFormulaHotspot = z.infer<typeof generationFormulaHotspotSchema>;

export const generationManualReviewItemSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    severity: unsupportedFeatureSeveritySchema,
    message: z.string().min(1),
    relatedPaths: z.array(z.string().min(1)),
    sourceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type GenerationManualReviewItem = z.infer<typeof generationManualReviewItemSchema>;

export const sqlGenerationPlanDetailsSchema = z
  .object({
    tablesToCreate: z.array(z.string().min(1)),
    columnsToCreate: z.array(
      z
        .object({
          table: z.string().min(1),
          column: z.string().min(1)
        })
        .strict()
    ),
    foreignKeysToCreate: z.array(z.string().min(1)),
    joinTablesToCreate: z.array(z.string().min(1)),
    unsupportedColumns: z.array(z.string().min(1)),
    unresolvedRelationships: z.array(z.string().min(1)),
    namingCollisions: z.array(z.string().min(1))
  })
  .strict();

export type SqlGenerationPlanDetails = z.infer<typeof sqlGenerationPlanDetailsSchema>;

export const functionsPlannedFunctionSchema = z
  .object({
    functionName: z.string().min(1),
    triggerType: z.string().min(1),
    sourceArtifactIds: z.array(artifactIdSchema),
    sourceFlowArtifactId: artifactIdSchema.optional(),
    sourceActionArtifactIds: z.array(artifactIdSchema),
    sourceFormulaArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type FunctionsPlannedFunction = z.infer<typeof functionsPlannedFunctionSchema>;

export const functionsManualReviewHotspotSchema = z
  .object({
    message: z.string().min(1),
    severity: unsupportedFeatureSeveritySchema,
    sourceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type FunctionsManualReviewHotspot = z.infer<typeof functionsManualReviewHotspotSchema>;

export const functionsUnsupportedActionSchema = z
  .object({
    flowName: z.string().min(1),
    actionName: z.string().min(1),
    actionType: z.string().min(1),
    sourceArtifactId: artifactIdSchema
  })
  .strict();

export type FunctionsUnsupportedAction = z.infer<typeof functionsUnsupportedActionSchema>;

export const functionsUnresolvedDependencySchema = z
  .object({
    referenceType: z.string().min(1),
    referenceName: z.string().min(1),
    sourceArtifactId: artifactIdSchema
  })
  .strict();

export type FunctionsUnresolvedDependency = z.infer<typeof functionsUnresolvedDependencySchema>;

export const functionsPlannedAdapterFileSchema = z
  .object({
    adapterName: z.string().min(1),
    filePath: z.string().min(1),
    methodCount: z.number().int().nonnegative(),
    sourceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type FunctionsPlannedAdapterFile = z.infer<typeof functionsPlannedAdapterFileSchema>;

export const functionsConnectorAdapterMappingSchema = z
  .object({
    connectorKey: z.string().min(1),
    adapterName: z.string().min(1),
    adapterFilePath: z.string().min(1),
    actionNames: z.array(z.string().min(1)),
    sourceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type FunctionsConnectorAdapterMapping = z.infer<typeof functionsConnectorAdapterMappingSchema>;

export const functionsTriggerStrategyModeSchema = z.enum([
  "http",
  "timer",
  "queue-placeholder",
  "webhook-placeholder",
  "event-grid-placeholder",
  "dataverse-event-placeholder",
  "email-ingestion-placeholder",
  "http-manual-fallback"
]);

export type FunctionsTriggerStrategyMode = z.infer<typeof functionsTriggerStrategyModeSchema>;

export const functionsTriggerStrategySchema = z
  .object({
    functionName: z.string().min(1),
    triggerClassification: z.string().min(1),
    strategy: functionsTriggerStrategyModeSchema,
    warning: z.string().min(1).optional()
  })
  .strict();

export type FunctionsTriggerStrategy = z.infer<typeof functionsTriggerStrategySchema>;

export const functionsHandlerSignatureSchema = z
  .object({
    functionName: z.string().min(1),
    exportedHandler: z.string().min(1),
    requestType: z.string().min(1),
    responseType: z.string().min(1),
    contextType: z.string().min(1)
  })
  .strict();

export type FunctionsHandlerSignature = z.infer<typeof functionsHandlerSignatureSchema>;

export const functionsUnresolvedAdapterRequirementSchema = z
  .object({
    connectorKey: z.string().min(1),
    requirement: z.string().min(1),
    sourceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export type FunctionsUnresolvedAdapterRequirement = z.infer<
  typeof functionsUnresolvedAdapterRequirementSchema
>;

export const functionsDeploymentReadinessSchema = z
  .object({
    scaffoldOnly: z.boolean(),
    needsConfig: z.boolean(),
    needsManualLogic: z.boolean(),
    blocked: z.boolean()
  })
  .strict();

export type FunctionsDeploymentReadiness = z.infer<typeof functionsDeploymentReadinessSchema>;

export const functionsGenerationPlanDetailsSchema = z
  .object({
    plannedFunctions: z.array(functionsPlannedFunctionSchema),
    plannedAdapterFiles: z.array(functionsPlannedAdapterFileSchema),
    connectorAdapterMappings: z.array(functionsConnectorAdapterMappingSchema),
    triggerStrategy: z.array(functionsTriggerStrategySchema),
    handlerSignatures: z.array(functionsHandlerSignatureSchema),
    manualReviewHotspots: z.array(functionsManualReviewHotspotSchema),
    unsupportedActions: z.array(functionsUnsupportedActionSchema),
    unresolvedDependencies: z.array(functionsUnresolvedDependencySchema),
    unresolvedAdapterRequirements: z.array(functionsUnresolvedAdapterRequirementSchema),
    deploymentReadiness: functionsDeploymentReadinessSchema
  })
  .strict();

export type FunctionsGenerationPlanDetails = z.infer<typeof functionsGenerationPlanDetailsSchema>;

export const infraDeploymentReadinessSchema = z
  .object({
    scaffoldOnly: z.boolean(),
    needsConfig: z.boolean(),
    needsSecurityReview: z.boolean(),
    blocked: z.boolean()
  })
  .strict();

export type InfraDeploymentReadiness = z.infer<typeof infraDeploymentReadinessSchema>;

export const infraContentHashEntrySchema = z
  .object({
    path: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type InfraContentHashEntry = z.infer<typeof infraContentHashEntrySchema>;

export const infraGenerationPlanDetailsSchema = z
  .object({
    plannedResources: z.array(z.string().min(1)),
    plannedModules: z.array(z.string().min(1)),
    environmentParameterFiles: z.array(z.string().min(1)),
    securityManualReviewItems: z.array(z.string().min(1)),
    unresolvedConfigurationItems: z.array(z.string().min(1)),
    contentHashes: z.array(infraContentHashEntrySchema),
    deploymentReadiness: infraDeploymentReadinessSchema
  })
  .strict();

export type InfraGenerationPlanDetails = z.infer<typeof infraGenerationPlanDetailsSchema>;

export const generationPlanSummarySchema = z
  .object({
    totalPlannedFiles: z.number().int().nonnegative(),
    totalPlannedDirectories: z.number().int().nonnegative(),
    creates: z.number().int().nonnegative(),
    overwrites: z.number().int().nonnegative(),
    skips: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    unsupportedFeatures: z.number().int().nonnegative(),
    formulaHotspots: z.number().int().nonnegative(),
    manualReviewItems: z.number().int().nonnegative()
  })
  .strict();

export type GenerationPlanSummary = z.infer<typeof generationPlanSummarySchema>;

export const generationPlanSchema = z
  .object({
    plannedFiles: z.array(generationPlannedFileSchema),
    plannedDirectories: z.array(z.string().min(1)),
    skippedFiles: z.array(generationSkippedFileSchema),
    overwrittenFiles: z.array(generationOverwrittenFileSchema),
    warnings: z.array(generationWarningSchema),
    unsupportedFeatures: z.array(generationUnsupportedFeatureSchema),
    formulaHotspots: z.array(generationFormulaHotspotSchema),
    manualReviewItems: z.array(generationManualReviewItemSchema),
    summary: generationPlanSummarySchema,
    sqlPlan: sqlGenerationPlanDetailsSchema.nullable(),
    functionsPlan: functionsGenerationPlanDetailsSchema.nullable(),
    infraPlan: infraGenerationPlanDetailsSchema.nullable()
  })
  .strict();

export type GenerationPlan = z.infer<typeof generationPlanSchema>;

export const createGenerationResultSchema = <TOutput extends z.ZodType>(outputSchema: TOutput) =>
  z
    .object({
      artifacts: z.array(generatedArtifactSchema),
      output: outputSchema,
      warnings: z.array(generationWarningSchema),
      unsupportedFeatures: z.array(generationUnsupportedFeatureSchema),
      confidence: confidenceScoreSchema,
      provenance: sourceProvenanceSchema
    })
    .strict();

export const unknownGenerationResultSchema = createGenerationResultSchema(z.unknown());

export type GenerationResult<TOutput> = z.infer<typeof unknownGenerationResultSchema> & {
  output: TOutput;
};

type GeneratorGenerateFunction<TInput, TOutput> = (
  input: TInput,
  context: GeneratorContext
) => Promise<GenerationResult<TOutput>>;

interface GeneratorDefinition {
  id: string;
  capabilities: GeneratorCapability[];
}

const generatorDefinitionSchema = z
  .object({
    id: generatorIdSchema,
    capabilities: z.array(generatorCapabilitySchema).min(1)
  })
  .strict();

export interface Generator<TInput, TOutput> extends GeneratorDefinition {
  generate: GeneratorGenerateFunction<TInput, TOutput>;
}

export const createGenerator = <TInput, TOutput>(input: {
  id: string;
  capabilities: GeneratorCapability[];
  generate: GeneratorGenerateFunction<TInput, TOutput>;
}): Generator<TInput, TOutput> => {
  const definition = generatorDefinitionSchema.parse({
    id: input.id,
    capabilities: input.capabilities
  });

  return {
    ...definition,
    generate: input.generate
  };
};

export const validateGenerationResult = <TSchema extends z.ZodType>(
  outputSchema: TSchema,
  result: unknown
): GenerationResult<z.infer<TSchema>> =>
  createGenerationResultSchema(outputSchema).parse(result) as GenerationResult<z.infer<TSchema>>;
