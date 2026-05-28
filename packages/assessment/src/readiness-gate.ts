import { z } from "zod";

import {
  parserWarningSchema,
  sortByStableKey,
  stableStringify,
  unsupportedFeatureSchema,
  type ParserWarning,
  type PowerPlatformIR,
  type UnsupportedFeature
} from "@power-exit/ir";

import {
  assessmentFindingSchema,
  assessmentReadinessSchema,
  type AssessmentFinding,
  type MigrationAssessment
} from "./models";

export const readinessGateStatusSchema = z.enum(["pass", "warn", "fail"]);

export const readinessGateThresholdsSchema = z
  .object({
    maxRiskScore: z.number().int().min(0).max(100),
    maxComplexityScore: z.number().int().min(0).max(100),
    minConfidence: z.number().min(0).max(1),
    allowCriticalUnsupported: z.boolean(),
    maxUnresolvedDependencies: z.number().int().nonnegative(),
    maxHighSeverityFindings: z.number().int().nonnegative(),
    requireNoBlockers: z.boolean()
  })
  .strict();

export type ReadinessGateThresholds = z.infer<typeof readinessGateThresholdsSchema>;

export const readinessGateManualReviewItemSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    message: z.string().min(1),
    relatedPaths: z.array(z.string().min(1))
  })
  .strict();

export type ReadinessGateManualReviewItem = z.infer<typeof readinessGateManualReviewItemSchema>;

export const readinessGateUnresolvedDependencySchema = z
  .object({
    id: z.string().min(1),
    referenceType: z.string().min(1),
    referenceName: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"])
  })
  .strict();

export type ReadinessGateUnresolvedDependency = z.infer<
  typeof readinessGateUnresolvedDependencySchema
>;

export const readinessGateGeneratorReadinessSchema = z
  .object({
    functionsBlocked: z.boolean(),
    infraBlocked: z.boolean(),
    functionsNeedsConfig: z.boolean(),
    infraNeedsConfig: z.boolean(),
    functionsNeedsManualLogic: z.boolean(),
    infraNeedsSecurityReview: z.boolean()
  })
  .strict();

export type ReadinessGateGeneratorReadiness = z.infer<
  typeof readinessGateGeneratorReadinessSchema
>;

export const readinessGateSchema = z
  .object({
    status: readinessGateStatusSchema,
    overallReadiness: assessmentReadinessSchema,
    riskScore: z.number().int().min(0).max(100),
    complexityScore: z.number().int().min(0).max(100),
    confidence: z.number().min(0).max(1),
    blockers: z.array(assessmentFindingSchema),
    warnings: z.array(parserWarningSchema),
    unresolvedDependencies: z.array(readinessGateUnresolvedDependencySchema),
    highSeverityFindings: z.array(assessmentFindingSchema),
    unsupportedFeatures: z.array(unsupportedFeatureSchema),
    manualReviewItems: z.array(readinessGateManualReviewItemSchema),
    thresholds: readinessGateThresholdsSchema,
    recommendations: z.array(z.string().min(1)),
    statusReasons: z.array(z.string().min(1))
  })
  .strict();

export type ReadinessGateStatus = z.infer<typeof readinessGateStatusSchema>;
export type ReadinessGate = z.infer<typeof readinessGateSchema>;

export interface EvaluateReadinessGateInput {
  assessment: MigrationAssessment;
  ir: PowerPlatformIR;
  thresholds?: Partial<ReadinessGateThresholds>;
  unresolvedDependencies?: ReadinessGateUnresolvedDependency[];
  manualReviewItems?: ReadinessGateManualReviewItem[];
  generatorReadiness?: Partial<ReadinessGateGeneratorReadiness>;
}

export const defaultReadinessGateThresholds: ReadinessGateThresholds = {
  maxRiskScore: 70,
  maxComplexityScore: 70,
  minConfidence: 0.6,
  allowCriticalUnsupported: false,
  maxUnresolvedDependencies: 6,
  maxHighSeverityFindings: 8,
  requireNoBlockers: true
};

const defaultGeneratorReadiness: ReadinessGateGeneratorReadiness = {
  functionsBlocked: false,
  infraBlocked: false,
  functionsNeedsConfig: false,
  infraNeedsConfig: false,
  functionsNeedsManualLogic: false,
  infraNeedsSecurityReview: false
};

const severityRank: Record<AssessmentFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

const toSortedFindings = (findings: readonly AssessmentFinding[]): AssessmentFinding[] =>
  sortByStableKey(findings, (finding) => `${severityRank[finding.severity]}:${finding.id}`);

const toSortedWarnings = (warnings: readonly ParserWarning[]): ParserWarning[] =>
  sortByStableKey(warnings, (warning) => `${warning.severity}:${warning.code}:${warning.sourceLocation}`);

const toSortedUnsupported = (
  unsupportedFeatures: readonly UnsupportedFeature[]
): UnsupportedFeature[] =>
  sortByStableKey(
    unsupportedFeatures,
    (feature) => `${feature.severity}:${feature.featureType}:${feature.sourceLocation}`
  );

const resolveBreachSeverity = (
  overBy: number,
  failThreshold: number
): "warn" | "fail" => (overBy > failThreshold ? "fail" : "warn");

const withStatusReason = (
  status: "warn" | "fail",
  failReasons: string[],
  warnReasons: string[],
  reason: string
): void => {
  if (status === "fail") {
    failReasons.push(reason);
    return;
  }

  warnReasons.push(reason);
};

export const evaluateReadinessGate = (input: EvaluateReadinessGateInput): ReadinessGate => {
  const thresholds = readinessGateThresholdsSchema.parse({
    ...defaultReadinessGateThresholds,
    ...(input.thresholds ?? {})
  });
  const generatorReadiness = readinessGateGeneratorReadinessSchema.parse({
    ...defaultGeneratorReadiness,
    ...(input.generatorReadiness ?? {})
  });
  const unresolvedDependencies = sortByStableKey(
    input.unresolvedDependencies ?? [],
    (entry) => `${entry.referenceType}:${entry.referenceName}:${entry.id}`
  );
  const manualReviewItems = sortByStableKey(
    input.manualReviewItems ?? [],
    (item) => `${item.severity}:${item.category}:${item.id}`
  );
  const blockers = toSortedFindings(input.assessment.blockers);
  const warnings = toSortedWarnings(input.ir.warnings);
  const highSeverityFindings = toSortedFindings(
    input.assessment.findings.filter((finding) =>
      finding.severity === "critical" || finding.severity === "high"
    )
  );
  const unsupportedFeatures = toSortedUnsupported(input.ir.unsupportedFeatures);
  const criticalUnsupported = unsupportedFeatures.filter((feature) => feature.severity === "critical");
  const blockersEnforced = thresholds.allowCriticalUnsupported
    ? blockers.filter(
        (blocker) =>
          !(
            blocker.severity === "critical" &&
            blocker.title.toLowerCase().includes("unsupported")
          )
      )
    : blockers;
  const failReasons: string[] = [];
  const warnReasons: string[] = [];

  if (thresholds.requireNoBlockers && blockersEnforced.length > 0) {
    failReasons.push(
      `Detected ${blockersEnforced.length} blockers while threshold requireNoBlockers=true.`
    );
  }

  if (!thresholds.allowCriticalUnsupported && criticalUnsupported.length > 0) {
    failReasons.push(
      `Detected ${criticalUnsupported.length} critical unsupported features while allowCriticalUnsupported=false.`
    );
  }

  if (generatorReadiness.functionsBlocked || generatorReadiness.infraBlocked) {
    failReasons.push(
      "Generator deployment readiness includes blocked=true for at least one scaffold."
    );
  }

  if (input.assessment.overallRiskScore > thresholds.maxRiskScore) {
    const overBy = input.assessment.overallRiskScore - thresholds.maxRiskScore;
    withStatusReason(
      resolveBreachSeverity(overBy, 10),
      failReasons,
      warnReasons,
      `Risk score ${input.assessment.overallRiskScore} exceeds maxRiskScore ${thresholds.maxRiskScore} by ${overBy}.`
    );
  }

  if (input.assessment.overallComplexityScore > thresholds.maxComplexityScore) {
    const overBy = input.assessment.overallComplexityScore - thresholds.maxComplexityScore;
    withStatusReason(
      resolveBreachSeverity(overBy, 10),
      failReasons,
      warnReasons,
      `Complexity score ${input.assessment.overallComplexityScore} exceeds maxComplexityScore ${thresholds.maxComplexityScore} by ${overBy}.`
    );
  }

  if (input.assessment.overallConfidence < thresholds.minConfidence) {
    const shortfall = thresholds.minConfidence - input.assessment.overallConfidence;
    withStatusReason(
      shortfall > 0.2 ? "fail" : "warn",
      failReasons,
      warnReasons,
      `Confidence ${input.assessment.overallConfidence.toFixed(2)} is below minConfidence ${thresholds.minConfidence.toFixed(2)} by ${shortfall.toFixed(2)}.`
    );
  }

  if (unresolvedDependencies.length > thresholds.maxUnresolvedDependencies) {
    const overBy = unresolvedDependencies.length - thresholds.maxUnresolvedDependencies;
    withStatusReason(
      resolveBreachSeverity(overBy, 3),
      failReasons,
      warnReasons,
      `Unresolved dependencies ${unresolvedDependencies.length} exceed maxUnresolvedDependencies ${thresholds.maxUnresolvedDependencies} by ${overBy}.`
    );
  }

  if (highSeverityFindings.length > thresholds.maxHighSeverityFindings) {
    const overBy = highSeverityFindings.length - thresholds.maxHighSeverityFindings;
    withStatusReason(
      resolveBreachSeverity(overBy, 3),
      failReasons,
      warnReasons,
      `High severity findings ${highSeverityFindings.length} exceed maxHighSeverityFindings ${thresholds.maxHighSeverityFindings} by ${overBy}.`
    );
  }

  if (
    !generatorReadiness.functionsBlocked &&
    (generatorReadiness.functionsNeedsConfig || generatorReadiness.functionsNeedsManualLogic)
  ) {
    warnReasons.push(
      "Functions scaffold requires manual configuration/logic before production use."
    );
  }

  if (
    !generatorReadiness.infraBlocked &&
    (generatorReadiness.infraNeedsConfig || generatorReadiness.infraNeedsSecurityReview)
  ) {
    warnReasons.push(
      "Infra scaffold requires manual configuration/security review before production use."
    );
  }

  const highManualReviewCount = manualReviewItems.filter(
    (item) => item.severity === "high" || item.severity === "critical"
  ).length;
  if (highManualReviewCount > 0) {
    warnReasons.push(
      `Manual review contains ${highManualReviewCount} high/critical items requiring explicit sign-off.`
    );
  }

  const status: ReadinessGateStatus =
    failReasons.length > 0 ? "fail" : warnReasons.length > 0 ? "warn" : "pass";
  const statusReasons =
    status === "pass"
      ? ["All configured thresholds passed with no blockers or critical unsupported features."]
      : status === "fail"
        ? failReasons
        : warnReasons;
  const recommendations = sortByStableKey(
    [
      ...statusReasons.map((reason) => `Resolve: ${reason}`),
      ...input.assessment.recommendations.slice(0, 5).map(
        (recommendation) => `${recommendation.title}: ${recommendation.description}`
      )
    ],
    (entry) => entry
  );

  return readinessGateSchema.parse({
    status,
    overallReadiness: input.assessment.overallReadiness,
    riskScore: input.assessment.overallRiskScore,
    complexityScore: input.assessment.overallComplexityScore,
    confidence: input.assessment.overallConfidence,
    blockers,
    warnings,
    unresolvedDependencies,
    highSeverityFindings,
    unsupportedFeatures,
    manualReviewItems,
    thresholds,
    recommendations,
    statusReasons
  });
};

const listOrNone = (items: string[]): string[] => (items.length > 0 ? items : ["None."]);

export const renderReadinessGateMarkdown = (gate: ReadinessGate): string => {
  const nextAction =
    gate.status === "fail"
      ? "Block progression and resolve fail reasons before migration execution."
      : gate.status === "warn"
        ? "Proceed only after manual review sign-off for warning items."
        : "Proceed to planned migration waves while monitoring residual warnings.";
  const lines: string[] = [];
  lines.push("# Power Exit Readiness Gate");
  lines.push("");
  lines.push("## Gate status");
  lines.push("");
  lines.push(`- Status: **${gate.status.toUpperCase()}**`);
  lines.push(`- Overall readiness: **${gate.overallReadiness}**`);
  lines.push(`- Risk score: **${gate.riskScore}**`);
  lines.push(`- Complexity score: **${gate.complexityScore}**`);
  lines.push(`- Confidence: **${gate.confidence.toFixed(2)}**`);
  lines.push("");
  lines.push("## Threshold summary");
  lines.push("");
  lines.push(`- maxRiskScore: ${gate.thresholds.maxRiskScore}`);
  lines.push(`- maxComplexityScore: ${gate.thresholds.maxComplexityScore}`);
  lines.push(`- minConfidence: ${gate.thresholds.minConfidence.toFixed(2)}`);
  lines.push(`- allowCriticalUnsupported: ${gate.thresholds.allowCriticalUnsupported}`);
  lines.push(`- maxUnresolvedDependencies: ${gate.thresholds.maxUnresolvedDependencies}`);
  lines.push(`- maxHighSeverityFindings: ${gate.thresholds.maxHighSeverityFindings}`);
  lines.push(`- requireNoBlockers: ${gate.thresholds.requireNoBlockers}`);
  lines.push("");
  lines.push("## Pass/fail reasons");
  lines.push("");
  listOrNone(gate.statusReasons).forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## Blockers");
  lines.push("");
  listOrNone(
    gate.blockers.map((blocker) => `[${blocker.severity}] ${blocker.title} — ${blocker.evidence}`)
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Unresolved dependencies");
  lines.push("");
  listOrNone(
    gate.unresolvedDependencies.map(
      (dependency) =>
        `[${dependency.severity}] ${dependency.referenceType}:${dependency.referenceName} — ${dependency.message}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## High severity findings");
  lines.push("");
  listOrNone(
    gate.highSeverityFindings.map(
      (finding) => `[${finding.severity}] ${finding.title} — ${finding.evidence}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Unsupported features");
  lines.push("");
  listOrNone(
    gate.unsupportedFeatures.map(
      (feature) =>
        `[${feature.severity}] ${feature.featureType} at ${feature.sourceLocation} — ${feature.reason}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Manual review items");
  lines.push("");
  listOrNone(
    gate.manualReviewItems.map(
      (item) =>
        `[${item.severity}] ${item.category}: ${item.message}${
          item.relatedPaths.length > 0 ? ` (paths: ${item.relatedPaths.join(", ")})` : ""
        }`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Recommended next action");
  lines.push("");
  lines.push(`- ${nextAction}`);
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  listOrNone(gate.recommendations).forEach((entry) => lines.push(`- ${entry}`));

  return `${lines.join("\n")}\n`;
};

export const serializeReadinessGate = (gate: ReadinessGate): string =>
  `${stableStringify(gate)}\n`;

