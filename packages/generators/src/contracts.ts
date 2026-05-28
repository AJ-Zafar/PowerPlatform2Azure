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
  "react-screen-skeleton"
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
