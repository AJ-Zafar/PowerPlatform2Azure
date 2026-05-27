import { z } from "zod";

import { stableStringify } from "./deterministic";
import { unknownParseResultSchema, type ParseResult } from "./parse-result";
import {
  analysisSummarySchema,
  dependencyEdgeSchema,
  powerPlatformIRSchema,
  solutionMetadataSchema,
  type AnalysisSummary,
  type DependencyEdge,
  type PowerPlatformIR,
  type SolutionMetadata
} from "./power-platform-ir";
import { type SourceProvenance } from "./provenance";

export interface CreateEmptyPowerPlatformIROptions {
  solutionName?: string;
  solutionUniqueName?: string;
  solutionVersion?: string;
  solutionFolder?: string;
  solutionArtifactId?: string;
  solutionPublisherUniqueName?: string;
  solutionPublisherDisplayName?: string;
  solutionManaged?: boolean;
  provenance?: SourceProvenance;
}

const DEFAULT_PROVENANCE: SourceProvenance = {
  sourcePath: "unknown",
  sourceType: "unknown"
};

const ensureArrayMergeData = (value: unknown, section: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Expected parse result data for "${section}" to be an array.`);
  }

  return value;
};

const ensureObjectMergeData = (
  value: unknown,
  section: string
): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected parse result data for "${section}" to be an object.`);
  }

  return value as Record<string, unknown>;
};

const mergeConfidence = (left: number, right: number): number =>
  Math.max(0, Math.min(1, Math.min(left, right)));

export type MergeablePowerPlatformIRSection =
  | "dataverse"
  | "canvasApps"
  | "cloudFlows"
  | "security"
  | "environmentVariables"
  | "connectionReferences";

export const validatePowerPlatformIR = (input: unknown): PowerPlatformIR =>
  powerPlatformIRSchema.parse(input);

export const createEmptyPowerPlatformIR = (
  options: CreateEmptyPowerPlatformIROptions = {}
): PowerPlatformIR => {
  const solutionFolder = options.solutionFolder ?? "unknown-solution";
  const provenance = options.provenance ?? {
    ...DEFAULT_PROVENANCE,
    sourcePath: solutionFolder,
    sourceType: "solution"
  };

  return validatePowerPlatformIR({
    solution: {
      artifactId: options.solutionArtifactId ?? "solution:default",
      name: options.solutionName ?? "Unknown Solution",
      uniqueName: options.solutionUniqueName ?? "unknown_solution",
      version: options.solutionVersion ?? "0.0.0",
      sourceFolder: solutionFolder,
      publisher: {
        uniqueName: options.solutionPublisherUniqueName ?? "unknown_publisher",
        displayName: options.solutionPublisherDisplayName ?? "Unknown Publisher"
      },
      managed: options.solutionManaged ?? false,
      localizedNames: [],
      provenance,
      confidence: 1
    },
    dataverse: {
      entities: [],
      relationships: [],
      optionSets: []
    },
    canvasApps: [],
    cloudFlows: [],
    security: {
      roles: []
    },
    environmentVariables: [],
    connectionReferences: [],
    dependencyGraph: {
      edges: []
    },
    analysisSummary: {
      filesScanned: 0,
      classifiedFiles: 0,
      unknownFiles: 0,
      solutionMetadataPresence: false,
      entities: 0,
      attributes: 0,
      relationships: 0,
      choices: 0,
      canvasApps: 0,
      canvasScreens: 0,
      canvasControls: 0,
      canvasFormulas: 0,
      environmentVariables: 0,
      connectionReferences: 0,
      securityRoles: 0,
      warnings: 0,
      unsupportedFeatures: 0,
      unresolvedDependencies: 0
    },
    unsupportedFeatures: [],
    warnings: [],
    provenance,
    confidence: 1
  });
};

export const mergeDependencyEdgesIntoIR = (
  ir: PowerPlatformIR,
  edges: DependencyEdge[]
): PowerPlatformIR =>
  validatePowerPlatformIR({
    ...ir,
    dependencyGraph: {
      edges: [
        ...ir.dependencyGraph.edges,
        ...edges.map((edge) => dependencyEdgeSchema.parse(edge))
      ]
    }
  });

export const mergeAnalysisSummaryIntoIR = (
  ir: PowerPlatformIR,
  summary: AnalysisSummary
): PowerPlatformIR =>
  validatePowerPlatformIR({
    ...ir,
    analysisSummary: analysisSummarySchema.parse(summary)
  });

export const mergeSolutionMetadataIntoIR = (
  ir: PowerPlatformIR,
  solutionMetadata: SolutionMetadata
): PowerPlatformIR =>
  validatePowerPlatformIR({
    ...ir,
    solution: solutionMetadataSchema.parse(solutionMetadata)
  });

export const serializeDeterministicIR = (input: unknown): string =>
  stableStringify(validatePowerPlatformIR(input));

export const mergeParseResultIntoIR = <T>(
  ir: PowerPlatformIR,
  section: MergeablePowerPlatformIRSection,
  parseResult: ParseResult<T>
): PowerPlatformIR => {
  const validatedParseResult = unknownParseResultSchema.parse(
    parseResult
  ) as ParseResult<unknown>;
  const mergedWarnings = [...ir.warnings, ...validatedParseResult.warnings];
  const mergedUnsupported = [
    ...ir.unsupportedFeatures,
    ...validatedParseResult.unsupported
  ];
  const mergedConfidence = mergeConfidence(
    ir.confidence,
    validatedParseResult.confidence
  );

  if (section === "dataverse") {
    const mergedData = ensureObjectMergeData(validatedParseResult.data, section);

    return validatePowerPlatformIR({
      ...ir,
      dataverse: {
        ...ir.dataverse,
        ...mergedData
      },
      warnings: mergedWarnings,
      unsupportedFeatures: mergedUnsupported,
      confidence: mergedConfidence
    });
  }

  if (section === "security") {
    const mergedData = ensureObjectMergeData(validatedParseResult.data, section);

    return validatePowerPlatformIR({
      ...ir,
      security: {
        ...ir.security,
        ...mergedData
      },
      warnings: mergedWarnings,
      unsupportedFeatures: mergedUnsupported,
      confidence: mergedConfidence
    });
  }

  const mergedData = ensureArrayMergeData(validatedParseResult.data, section);

  if (section === "canvasApps") {
    return validatePowerPlatformIR({
      ...ir,
      canvasApps: [...ir.canvasApps, ...mergedData],
      warnings: mergedWarnings,
      unsupportedFeatures: mergedUnsupported,
      confidence: mergedConfidence
    });
  }

  if (section === "cloudFlows") {
    return validatePowerPlatformIR({
      ...ir,
      cloudFlows: [...ir.cloudFlows, ...mergedData],
      warnings: mergedWarnings,
      unsupportedFeatures: mergedUnsupported,
      confidence: mergedConfidence
    });
  }

  if (section === "environmentVariables") {
    return validatePowerPlatformIR({
      ...ir,
      environmentVariables: [...ir.environmentVariables, ...mergedData],
      warnings: mergedWarnings,
      unsupportedFeatures: mergedUnsupported,
      confidence: mergedConfidence
    });
  }

  return validatePowerPlatformIR({
    ...ir,
    connectionReferences: [...ir.connectionReferences, ...mergedData],
    warnings: mergedWarnings,
    unsupportedFeatures: mergedUnsupported,
    confidence: mergedConfidence
  });
};

export const assertSchema = <TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> => schema.parse(value);
