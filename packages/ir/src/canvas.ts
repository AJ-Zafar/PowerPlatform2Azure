import { z } from "zod";

import { artifactIdSchema } from "./artifact-id";
import { confidenceScoreSchema } from "./confidence";
import { sourceProvenanceSchema } from "./provenance";
import { unsupportedFeatureSchema } from "./unsupported-feature";
import { parserWarningSchema } from "./warnings";

export const canvasFormulaFeatureSchema = z.enum([
  "navigate",
  "patch",
  "submitForm",
  "collect",
  "clearCollect",
  "set",
  "updateContext",
  "unknown"
]);

export const canvasLayoutPropertiesSchema = z
  .object({
    X: z.union([z.number(), z.string()]).optional(),
    Y: z.union([z.number(), z.string()]).optional(),
    Width: z.union([z.number(), z.string()]).optional(),
    Height: z.union([z.number(), z.string()]).optional(),
    Visible: z.union([z.boolean(), z.string()]).optional(),
    DisplayMode: z.string().optional(),
    Fill: z.string().optional(),
    Color: z.string().optional(),
    Align: z.string().optional(),
    LayoutDirection: z.string().optional(),
    Wrap: z.union([z.boolean(), z.string()]).optional(),
    TemplateSize: z.union([z.number(), z.string()]).optional()
  })
  .strict();

export const canvasFormulaSchema = z
  .object({
    artifactId: artifactIdSchema,
    ownerArtifactId: artifactIdSchema.optional(),
    ownerType: z.enum(["app", "screen", "control", "component", "unknown"]),
    propertyName: z.string().optional(),
    rawExpression: z.string().min(1),
    functionNames: z.array(z.string().min(1)),
    likelyDataSources: z.array(z.string().min(1)),
    likelyVariables: z.array(z.string().min(1)),
    likelyCollections: z.array(z.string().min(1)),
    navigationTargetScreen: z.string().optional(),
    formulaFeatures: z.array(canvasFormulaFeatureSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasControlSchema = z
  .object({
    artifactId: artifactIdSchema,
    controlName: z.string().min(1),
    controlType: z.string().min(1),
    parentControl: artifactIdSchema.optional(),
    children: z.array(artifactIdSchema),
    properties: z.record(z.string(), z.unknown()),
    formulasByProperty: z.array(
      z
        .object({
          propertyName: z.string().min(1),
          formulaArtifactId: artifactIdSchema
        })
        .strict()
    ),
    formulas: z.array(canvasFormulaSchema),
    layoutProperties: canvasLayoutPropertiesSchema,
    dataBindingHints: z.array(z.string().min(1)),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasScreenSchema = z
  .object({
    artifactId: artifactIdSchema,
    screenName: z.string().min(1),
    sourceFile: z.string().min(1),
    controls: z.array(canvasControlSchema),
    formulas: z.array(canvasFormulaSchema),
    layoutMetadata: z.record(z.string(), z.unknown()),
    order: z.number().int().nonnegative().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasComponentSchema = z
  .object({
    artifactId: artifactIdSchema,
    componentName: z.string().min(1),
    sourceFile: z.string().min(1),
    controls: z.array(canvasControlSchema),
    formulas: z.array(canvasFormulaSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasResourceSchema = z
  .object({
    artifactId: artifactIdSchema,
    resourceType: z.string().min(1),
    resourceName: z.string().min(1),
    resourcePath: z.string().min(1),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const canvasDataSourceSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
    sourceType: z.string().min(1),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

const canvasNamedValueSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
    inferredType: z.string().optional(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasNavigationReferenceSchema = z
  .object({
    artifactId: artifactIdSchema,
    sourceFormulaArtifactId: artifactIdSchema,
    targetScreenName: z.string().min(1),
    targetScreenArtifactId: artifactIdSchema.optional(),
    resolved: z.boolean(),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export const canvasAppSchema = z
  .object({
    artifactId: artifactIdSchema,
    appId: z.string().min(1),
    appName: z.string().min(1),
    appProperties: z.record(z.string(), z.unknown()),
    screens: z.array(canvasScreenSchema),
    components: z.array(canvasComponentSchema),
    resources: z.array(canvasResourceSchema),
    dataSources: z.array(canvasDataSourceSchema),
    variables: z.array(canvasNamedValueSchema),
    collections: z.array(canvasNamedValueSchema),
    navigationReferences: z.array(canvasNavigationReferenceSchema),
    formulas: z.array(canvasFormulaSchema),
    unsupportedFeatures: z.array(unsupportedFeatureSchema),
    warnings: z.array(parserWarningSchema),
    provenance: sourceProvenanceSchema,
    confidence: confidenceScoreSchema
  })
  .strict();

export type CanvasFormula = z.infer<typeof canvasFormulaSchema>;
export type CanvasControl = z.infer<typeof canvasControlSchema>;
export type CanvasScreen = z.infer<typeof canvasScreenSchema>;
export type CanvasComponent = z.infer<typeof canvasComponentSchema>;
export type CanvasResource = z.infer<typeof canvasResourceSchema>;
export type CanvasNavigationReference = z.infer<
  typeof canvasNavigationReferenceSchema
>;
export type CanvasApp = z.infer<typeof canvasAppSchema>;
