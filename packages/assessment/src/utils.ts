import {
  sortByStableKey,
  type ParserWarning,
  type PowerPlatformIR,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import {
  type AssessmentCategory,
  type AssessmentFinding,
  type AssessmentReadiness,
  type AssessmentSeverity
} from "./models";

export const clampRiskScore = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

export const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Number(value.toFixed(3))));

export const readinessFromScore = (
  score: number,
  hasCriticalBlocker: boolean
): AssessmentReadiness => {
  if (hasCriticalBlocker || score < 30) {
    return "blocked";
  }

  if (score < 50) {
    return "low";
  }

  if (score < 75) {
    return "medium";
  }

  return "high";
};

interface CreateFindingInput {
  id: string;
  title: string;
  description: string;
  severity: AssessmentSeverity;
  category: AssessmentCategory;
  affectedArtifactIds?: string[];
  evidence: string;
  recommendation: string;
  confidence: number;
  provenance?: SourceProvenance;
}

export const createAssessmentFinding = (
  input: CreateFindingInput
): AssessmentFinding => ({
  id: input.id,
  title: input.title,
  description: input.description,
  severity: input.severity,
  category: input.category,
  affectedArtifactIds: sortByStableKey(input.affectedArtifactIds ?? [], (artifactId) => artifactId),
  evidence: input.evidence,
  recommendation: input.recommendation,
  confidence: clampConfidence(input.confidence),
  provenance: input.provenance
});

export const warningsByPrefix = (
  warnings: readonly ParserWarning[],
  prefix: string
): ParserWarning[] =>
  sortByStableKey(
    warnings.filter((warning) => warning.code.startsWith(prefix)),
    (warning) => `${warning.code}:${warning.sourceLocation}`
  );

export const warningsByCodes = (
  warnings: readonly ParserWarning[],
  codes: readonly string[]
): ParserWarning[] =>
  sortByStableKey(
    warnings.filter((warning) => codes.includes(warning.code)),
    (warning) => `${warning.code}:${warning.sourceLocation}`
  );

export const unsupportedByPrefix = (
  unsupported: readonly UnsupportedFeature[],
  prefix: string
): UnsupportedFeature[] =>
  sortByStableKey(
    unsupported.filter((feature) => feature.featureType.startsWith(prefix)),
    (feature) => `${feature.featureType}:${feature.sourceLocation}`
  );

export const unsupportedBySeverity = (
  unsupported: readonly UnsupportedFeature[],
  severity: UnsupportedFeature["severity"]
): UnsupportedFeature[] =>
  sortByStableKey(
    unsupported.filter((feature) => feature.severity === severity),
    (feature) => `${feature.featureType}:${feature.sourceLocation}`
  );

export const averageConfidence = (values: readonly number[], fallback = 0.5): number => {
  if (values.length === 0) {
    return clampConfidence(fallback);
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return clampConfidence(total / values.length);
};

export const unresolvedDependencyEdges = (ir: PowerPlatformIR) =>
  sortByStableKey(
    ir.dependencyGraph.edges.filter((edge) => edge.resolved === false),
    (edge) => `${edge.sourceArtifactId}:${edge.targetArtifactId}:${edge.dependencyType}`
  );
