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
export const readinessGatePolicyProfileNameSchema = z.enum([
  "dev",
  "test",
  "prod",
  "strict"
]);

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

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date format YYYY-MM-DD.");

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

export const readinessGateWaiverAppliesToSchema = z
  .object({
    findingId: z.string().min(1).optional(),
    unsupportedFeatureId: z.string().min(1).optional(),
    dependencyId: z.string().min(1).optional(),
    artifactId: z.string().min(1).optional(),
    category: z.string().min(1).optional()
  })
  .strict()
  .refine(
    (appliesTo) =>
      [
        appliesTo.findingId,
        appliesTo.unsupportedFeatureId,
        appliesTo.dependencyId,
        appliesTo.artifactId,
        appliesTo.category
      ].some((value) => value !== undefined),
    "Waiver appliesTo must include at least one selector."
  );

export const readinessGateWaiverSchema = z
  .object({
    waiverId: z.string().min(1),
    appliesTo: readinessGateWaiverAppliesToSchema,
    reason: z.string().min(1),
    owner: z.string().min(1),
    expiresOn: isoDateSchema,
    approvedBy: z.string().min(1),
    evidenceLink: z.string().min(1).optional(),
    riskAccepted: z.boolean(),
    createdOn: isoDateSchema
  })
  .strict();

export type ReadinessGateWaiver = z.infer<typeof readinessGateWaiverSchema>;

export const readinessGatePolicyOverrideSchema = z
  .object({
    waivable: z.boolean(),
    downgradeTo: readinessGateStatusSchema.exclude(["pass"])
  })
  .strict();

export type ReadinessGatePolicyOverride = z.infer<typeof readinessGatePolicyOverrideSchema>;

export const readinessGatePolicyProfileSchema = z
  .object({
    profileName: readinessGatePolicyProfileNameSchema,
    description: z.string().min(1),
    thresholds: readinessGateThresholdsSchema,
    severityOverrides: z
      .record(z.string().min(1), readinessGatePolicyOverrideSchema)
      .default({}),
    categoryOverrides: z
      .record(z.string().min(1), readinessGatePolicyOverrideSchema)
      .default({}),
    allowedWaivers: z.array(readinessGateWaiverSchema).default([]),
    requiredEvidence: z.array(z.string().min(1)).default([]),
    metadata: z.record(z.string().min(1), z.string().min(1)).default({})
  })
  .strict();

export const readinessGatePolicyFileSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    description: z.string().min(1),
    profiles: z.array(readinessGatePolicyProfileSchema).min(1)
  })
  .strict();

export type ReadinessGatePolicyProfile = z.infer<typeof readinessGatePolicyProfileSchema>;
export type ReadinessGatePolicyFile = z.infer<typeof readinessGatePolicyFileSchema>;

export const readinessGateAppliedWaiverSchema = z
  .object({
    waiverId: z.string().min(1),
    targetType: z.enum(["finding", "unsupported-feature", "dependency"]),
    targetId: z.string().min(1),
    category: z.string().min(1),
    severity: z.string().min(1),
    reason: z.string().min(1),
    owner: z.string().min(1),
    approvedBy: z.string().min(1),
    expiresOn: isoDateSchema,
    createdOn: isoDateSchema,
    evidenceLink: z.string().min(1).optional(),
    riskAccepted: z.boolean()
  })
  .strict();

export type ReadinessGateAppliedWaiver = z.infer<typeof readinessGateAppliedWaiverSchema>;

export const readinessGateRejectedWaiverSchema = z
  .object({
    waiverId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

export type ReadinessGateRejectedWaiver = z.infer<typeof readinessGateRejectedWaiverSchema>;

export const readinessGateNonWaivableBlockerSchema = z
  .object({
    targetType: z.enum(["finding", "unsupported-feature", "dependency"]),
    targetId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

export type ReadinessGateNonWaivableBlocker = z.infer<
  typeof readinessGateNonWaivableBlockerSchema
>;

export const readinessGateWaiverAuditSchema = z
  .object({
    appliedWaivers: z.array(readinessGateAppliedWaiverSchema),
    expiredWaivers: z.array(readinessGateRejectedWaiverSchema),
    invalidWaivers: z.array(readinessGateRejectedWaiverSchema),
    waivedCount: z.number().int().nonnegative(),
    expiredCount: z.number().int().nonnegative(),
    invalidCount: z.number().int().nonnegative(),
    nonWaivableBlockers: z.array(readinessGateNonWaivableBlockerSchema)
  })
  .strict();

export type ReadinessGateWaiverAudit = z.infer<typeof readinessGateWaiverAuditSchema>;

export const readinessGatePolicyContextSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    profileName: readinessGatePolicyProfileNameSchema,
    description: z.string().min(1),
    requiredEvidence: z.array(z.string().min(1)),
    metadata: z.record(z.string().min(1), z.string().min(1)),
    sourcePolicyFile: z.string().min(1).optional()
  })
  .strict();

export type ReadinessGatePolicyContext = z.infer<typeof readinessGatePolicyContextSchema>;

export const readinessGateSchema = z
  .object({
    status: readinessGateStatusSchema,
    originalStatus: readinessGateStatusSchema,
    effectiveStatus: readinessGateStatusSchema,
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
    policy: readinessGatePolicyContextSchema.nullable(),
    waiverAudit: readinessGateWaiverAuditSchema,
    recommendations: z.array(z.string().min(1)),
    statusReasons: z.array(z.string().min(1)),
    originalStatusReasons: z.array(z.string().min(1))
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
  policy?: ReadinessGatePolicyProfile | null;
  waivers?: ReadinessGateWaiver[];
  evaluationDate?: string;
  sourcePolicyFile?: string;
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

export const defaultReadinessGatePolicyProfiles: ReadinessGatePolicyProfile[] = [
  {
    profileName: "dev",
    description:
      "Developer profile prioritizes flow while still surfacing migration governance risk.",
    thresholds: {
      maxRiskScore: 85,
      maxComplexityScore: 85,
      minConfidence: 0.5,
      allowCriticalUnsupported: true,
      maxUnresolvedDependencies: 12,
      maxHighSeverityFindings: 12,
      requireNoBlockers: false
    },
    severityOverrides: {
      critical: {
        waivable: true,
        downgradeTo: "warn"
      },
      high: {
        waivable: true,
        downgradeTo: "warn"
      }
    },
    categoryOverrides: {},
    allowedWaivers: [],
    requiredEvidence: [],
    metadata: {
      intendedEnvironment: "developer"
    }
  },
  {
    profileName: "test",
    description:
      "Test profile enforces stronger confidence while allowing reviewed waivers for integration testing.",
    thresholds: {
      maxRiskScore: 75,
      maxComplexityScore: 75,
      minConfidence: 0.6,
      allowCriticalUnsupported: false,
      maxUnresolvedDependencies: 8,
      maxHighSeverityFindings: 8,
      requireNoBlockers: true
    },
    severityOverrides: {
      critical: {
        waivable: false,
        downgradeTo: "fail"
      },
      high: {
        waivable: true,
        downgradeTo: "warn"
      }
    },
    categoryOverrides: {},
    allowedWaivers: [],
    requiredEvidence: ["link-to-test-risk-register"],
    metadata: {
      intendedEnvironment: "integration-test"
    }
  },
  {
    profileName: "prod",
    description:
      "Production profile applies conservative readiness thresholds and explicit waiver evidence requirements.",
    thresholds: {
      ...defaultReadinessGateThresholds,
      minConfidence: 0.65,
      maxUnresolvedDependencies: 4,
      maxHighSeverityFindings: 5
    },
    severityOverrides: {
      critical: {
        waivable: false,
        downgradeTo: "fail"
      },
      high: {
        waivable: true,
        downgradeTo: "warn"
      }
    },
    categoryOverrides: {},
    allowedWaivers: [],
    requiredEvidence: ["link-to-risk-register", "approval-record"],
    metadata: {
      intendedEnvironment: "production"
    }
  },
  {
    profileName: "strict",
    description:
      "Strict profile is governance-first and blocks all critical/high risk debt before migration execution.",
    thresholds: {
      maxRiskScore: 60,
      maxComplexityScore: 60,
      minConfidence: 0.75,
      allowCriticalUnsupported: false,
      maxUnresolvedDependencies: 0,
      maxHighSeverityFindings: 2,
      requireNoBlockers: true
    },
    severityOverrides: {
      critical: {
        waivable: false,
        downgradeTo: "fail"
      },
      high: {
        waivable: false,
        downgradeTo: "fail"
      },
      medium: {
        waivable: true,
        downgradeTo: "warn"
      }
    },
    categoryOverrides: {},
    allowedWaivers: [],
    requiredEvidence: [
      "link-to-risk-register",
      "security-signoff",
      "architecture-signoff"
    ],
    metadata: {
      intendedEnvironment: "strict-governance"
    }
  }
];

export const createDefaultReadinessGatePolicyFile = (): ReadinessGatePolicyFile =>
  readinessGatePolicyFileSchema.parse({
    schemaVersion: "1.0",
    description: "Default Power Exit readiness gate policy profiles.",
    profiles: defaultReadinessGatePolicyProfiles
  });

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

interface GateTarget {
  targetType: "finding" | "unsupported-feature" | "dependency";
  targetId: string;
  category: string;
  severity: string;
  artifactIds: string[];
}

const unsupportedFeatureId = (feature: UnsupportedFeature): string =>
  `${feature.featureType}:${feature.sourceLocation}`;

const toGateTargets = (input: {
  blockers: AssessmentFinding[];
  highSeverityFindings: AssessmentFinding[];
  unsupportedFeatures: UnsupportedFeature[];
  unresolvedDependencies: ReadinessGateUnresolvedDependency[];
}): GateTarget[] => {
  const findingTargets = [...input.blockers, ...input.highSeverityFindings].map((finding) => ({
    targetType: "finding" as const,
    targetId: finding.id,
    category: finding.category,
    severity: finding.severity,
    artifactIds: finding.affectedArtifactIds
  }));
  const unsupportedTargets = input.unsupportedFeatures.map((feature) => ({
    targetType: "unsupported-feature" as const,
    targetId: unsupportedFeatureId(feature),
    category: "unsupported-feature",
    severity: feature.severity,
    artifactIds: feature.provenance.artifactId ? [feature.provenance.artifactId] : []
  }));
  const dependencyTargets = input.unresolvedDependencies.map((dependency) => ({
    targetType: "dependency" as const,
    targetId: dependency.id,
    category: dependency.referenceType,
    severity: dependency.severity,
    artifactIds: []
  }));

  return sortByStableKey(
    [...findingTargets, ...unsupportedTargets, ...dependencyTargets],
    (target) => `${target.targetType}:${target.targetId}:${target.category}:${target.severity}`
  );
};

const normalizeEvaluationDate = (inputDate: string | undefined): string => {
  if (inputDate === undefined) {
    return new Date().toISOString().slice(0, 10);
  }

  return inputDate.includes("T") ? inputDate.slice(0, 10) : inputDate;
};

const evaluateGateStatus = (input: {
  thresholds: ReadinessGateThresholds;
  generatorReadiness: ReadinessGateGeneratorReadiness;
  blockersEnforcedCount: number;
  criticalUnsupportedCount: number;
  unresolvedDependencyCount: number;
  highSeverityFindingCount: number;
  riskScore: number;
  complexityScore: number;
  confidence: number;
  highManualReviewCount: number;
}): {
  status: ReadinessGateStatus;
  failReasons: string[];
  warnReasons: string[];
} => {
  const failReasons: string[] = [];
  const warnReasons: string[] = [];

  if (input.thresholds.requireNoBlockers && input.blockersEnforcedCount > 0) {
    failReasons.push(
      `Detected ${input.blockersEnforcedCount} blockers while threshold requireNoBlockers=true.`
    );
  }

  if (!input.thresholds.allowCriticalUnsupported && input.criticalUnsupportedCount > 0) {
    failReasons.push(
      `Detected ${input.criticalUnsupportedCount} critical unsupported features while allowCriticalUnsupported=false.`
    );
  }

  if (input.generatorReadiness.functionsBlocked || input.generatorReadiness.infraBlocked) {
    failReasons.push(
      "Generator deployment readiness includes blocked=true for at least one scaffold."
    );
  }

  if (input.riskScore > input.thresholds.maxRiskScore) {
    const overBy = input.riskScore - input.thresholds.maxRiskScore;
    withStatusReason(
      resolveBreachSeverity(overBy, 10),
      failReasons,
      warnReasons,
      `Risk score ${input.riskScore} exceeds maxRiskScore ${input.thresholds.maxRiskScore} by ${overBy}.`
    );
  }

  if (input.complexityScore > input.thresholds.maxComplexityScore) {
    const overBy = input.complexityScore - input.thresholds.maxComplexityScore;
    withStatusReason(
      resolveBreachSeverity(overBy, 10),
      failReasons,
      warnReasons,
      `Complexity score ${input.complexityScore} exceeds maxComplexityScore ${input.thresholds.maxComplexityScore} by ${overBy}.`
    );
  }

  if (input.confidence < input.thresholds.minConfidence) {
    const shortfall = input.thresholds.minConfidence - input.confidence;
    withStatusReason(
      shortfall > 0.2 ? "fail" : "warn",
      failReasons,
      warnReasons,
      `Confidence ${input.confidence.toFixed(2)} is below minConfidence ${input.thresholds.minConfidence.toFixed(2)} by ${shortfall.toFixed(2)}.`
    );
  }

  if (input.unresolvedDependencyCount > input.thresholds.maxUnresolvedDependencies) {
    const overBy = input.unresolvedDependencyCount - input.thresholds.maxUnresolvedDependencies;
    withStatusReason(
      resolveBreachSeverity(overBy, 3),
      failReasons,
      warnReasons,
      `Unresolved dependencies ${input.unresolvedDependencyCount} exceed maxUnresolvedDependencies ${input.thresholds.maxUnresolvedDependencies} by ${overBy}.`
    );
  }

  if (input.highSeverityFindingCount > input.thresholds.maxHighSeverityFindings) {
    const overBy = input.highSeverityFindingCount - input.thresholds.maxHighSeverityFindings;
    withStatusReason(
      resolveBreachSeverity(overBy, 3),
      failReasons,
      warnReasons,
      `High severity findings ${input.highSeverityFindingCount} exceed maxHighSeverityFindings ${input.thresholds.maxHighSeverityFindings} by ${overBy}.`
    );
  }

  if (
    !input.generatorReadiness.functionsBlocked &&
    (input.generatorReadiness.functionsNeedsConfig ||
      input.generatorReadiness.functionsNeedsManualLogic)
  ) {
    warnReasons.push(
      "Functions scaffold requires manual configuration/logic before production use."
    );
  }

  if (
    !input.generatorReadiness.infraBlocked &&
    (input.generatorReadiness.infraNeedsConfig ||
      input.generatorReadiness.infraNeedsSecurityReview)
  ) {
    warnReasons.push(
      "Infra scaffold requires manual configuration/security review before production use."
    );
  }

  if (input.highManualReviewCount > 0) {
    warnReasons.push(
      `Manual review contains ${input.highManualReviewCount} high/critical items requiring explicit sign-off.`
    );
  }

  return {
    status:
      failReasons.length > 0 ? "fail" : warnReasons.length > 0 ? "warn" : "pass",
    failReasons,
    warnReasons
  };
};

export const evaluateReadinessGate = (input: EvaluateReadinessGateInput): ReadinessGate => {
  const policyProfile = input.policy
    ? readinessGatePolicyProfileSchema.parse(input.policy)
    : null;
  const thresholds = readinessGateThresholdsSchema.parse({
    ...defaultReadinessGateThresholds,
    ...(policyProfile?.thresholds ?? {}),
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
  const highManualReviewCount = manualReviewItems.filter(
    (item) => item.severity === "high" || item.severity === "critical"
  ).length;
  const blockersEnforced = thresholds.allowCriticalUnsupported
    ? blockers.filter(
        (blocker) =>
          !(
            blocker.severity === "critical" &&
            blocker.title.toLowerCase().includes("unsupported")
          )
      )
    : blockers;
  const originalStatusEvaluation = evaluateGateStatus({
    thresholds,
    generatorReadiness,
    blockersEnforcedCount: blockersEnforced.length,
    criticalUnsupportedCount: criticalUnsupported.length,
    unresolvedDependencyCount: unresolvedDependencies.length,
    highSeverityFindingCount: highSeverityFindings.length,
    riskScore: input.assessment.overallRiskScore,
    complexityScore: input.assessment.overallComplexityScore,
    confidence: input.assessment.overallConfidence,
    highManualReviewCount
  });

  const evaluationDate = isoDateSchema.parse(normalizeEvaluationDate(input.evaluationDate));
  const waiverTargets = toGateTargets({
    blockers,
    highSeverityFindings,
    unsupportedFeatures,
    unresolvedDependencies
  });
  const policySeverityOverrides = policyProfile?.severityOverrides ?? {};
  const policyCategoryOverrides = policyProfile?.categoryOverrides ?? {};
  const requiredEvidence = policyProfile?.requiredEvidence ?? [];
  const targetByKey = new Map(
    waiverTargets.map((target) => [`${target.targetType}:${target.targetId}`, target])
  );
  const allWaivers = sortByStableKey(
    [...(policyProfile?.allowedWaivers ?? []), ...(input.waivers ?? [])],
    (waiver) => waiver.waiverId
  );
  const appliedWaivers: ReadinessGateAppliedWaiver[] = [];
  const expiredWaivers: ReadinessGateRejectedWaiver[] = [];
  const invalidWaivers: ReadinessGateRejectedWaiver[] = [];
  const nonWaivableBlockers: ReadinessGateNonWaivableBlocker[] = [];
  const waivedTargetKeys = new Set<string>();

  for (const waiver of allWaivers) {
    const waiverSelectors = [
      waiver.appliesTo.findingId
        ? `finding:${waiver.appliesTo.findingId}`
        : undefined,
      waiver.appliesTo.unsupportedFeatureId
        ? `unsupported-feature:${waiver.appliesTo.unsupportedFeatureId}`
        : undefined,
      waiver.appliesTo.dependencyId
        ? `dependency:${waiver.appliesTo.dependencyId}`
        : undefined
    ].filter((selector): selector is string => selector !== undefined);
    const matchedTargets = waiverTargets.filter((target) => {
      if (waiverSelectors.includes(`${target.targetType}:${target.targetId}`)) {
        return true;
      }
      if (
        waiver.appliesTo.artifactId !== undefined &&
        target.artifactIds.includes(waiver.appliesTo.artifactId)
      ) {
        return true;
      }
      if (waiver.appliesTo.category !== undefined && target.category === waiver.appliesTo.category) {
        return true;
      }
      return false;
    });

    if (waiver.expiresOn < evaluationDate) {
      expiredWaivers.push({
        waiverId: waiver.waiverId,
        reason: `Waiver expired on ${waiver.expiresOn}.`
      });
      continue;
    }

    if (requiredEvidence.length > 0 && waiver.evidenceLink === undefined) {
      invalidWaivers.push({
        waiverId: waiver.waiverId,
        reason: `Policy profile requires evidence (${requiredEvidence.join(", ")}).`
      });
      continue;
    }

    if (matchedTargets.length === 0) {
      invalidWaivers.push({
        waiverId: waiver.waiverId,
        reason: "Waiver did not match any gate finding, dependency, or unsupported feature."
      });
      continue;
    }

    const disallowedTarget = matchedTargets.find((target) => {
      const severityOverride = policySeverityOverrides[target.severity];
      const categoryOverride = policyCategoryOverrides[target.category];
      const waivable = categoryOverride?.waivable ?? severityOverride?.waivable ?? true;
      return !waivable;
    });

    if (disallowedTarget !== undefined) {
      nonWaivableBlockers.push({
        targetType: disallowedTarget.targetType,
        targetId: disallowedTarget.targetId,
        reason: `Policy does not allow waivers for ${disallowedTarget.severity}/${disallowedTarget.category}.`
      });
      invalidWaivers.push({
        waiverId: waiver.waiverId,
        reason: `Waiver targets non-waivable item ${disallowedTarget.targetType}:${disallowedTarget.targetId}.`
      });
      continue;
    }

    const criticalTarget = matchedTargets.find((target) => target.severity === "critical");
    if (criticalTarget !== undefined && !waiver.riskAccepted) {
      invalidWaivers.push({
        waiverId: waiver.waiverId,
        reason:
          "Critical waiver target requires explicit riskAccepted=true before waiver can apply."
      });
      continue;
    }

    for (const matchedTarget of matchedTargets) {
      const key = `${matchedTarget.targetType}:${matchedTarget.targetId}`;
      if (waivedTargetKeys.has(key)) {
        continue;
      }

      const target = targetByKey.get(key);
      if (target === undefined) {
        continue;
      }
      waivedTargetKeys.add(key);
      appliedWaivers.push({
        waiverId: waiver.waiverId,
        targetType: target.targetType,
        targetId: target.targetId,
        category: target.category,
        severity: target.severity,
        reason: waiver.reason,
        owner: waiver.owner,
        approvedBy: waiver.approvedBy,
        expiresOn: waiver.expiresOn,
        createdOn: waiver.createdOn,
        evidenceLink: waiver.evidenceLink,
        riskAccepted: waiver.riskAccepted
      });
    }
  }

  const effectiveBlockersEnforced = blockersEnforced.filter(
    (blocker) => !waivedTargetKeys.has(`finding:${blocker.id}`)
  );
  const effectiveCriticalUnsupported = criticalUnsupported.filter(
    (feature) =>
      !waivedTargetKeys.has(`unsupported-feature:${unsupportedFeatureId(feature)}`)
  );
  const effectiveUnresolvedDependencies = unresolvedDependencies.filter(
    (dependency) => !waivedTargetKeys.has(`dependency:${dependency.id}`)
  );
  const effectiveHighSeverityFindings = highSeverityFindings.filter(
    (finding) => !waivedTargetKeys.has(`finding:${finding.id}`)
  );
  const effectiveStatusEvaluation = evaluateGateStatus({
    thresholds,
    generatorReadiness,
    blockersEnforcedCount: effectiveBlockersEnforced.length,
    criticalUnsupportedCount: effectiveCriticalUnsupported.length,
    unresolvedDependencyCount: effectiveUnresolvedDependencies.length,
    highSeverityFindingCount: effectiveHighSeverityFindings.length,
    riskScore: input.assessment.overallRiskScore,
    complexityScore: input.assessment.overallComplexityScore,
    confidence: input.assessment.overallConfidence,
    highManualReviewCount
  });
  const effectiveWarnReasons = [...effectiveStatusEvaluation.warnReasons];
  if (appliedWaivers.length > 0) {
    effectiveWarnReasons.push(
      `Applied ${appliedWaivers.length} waiver(s); manual governance review remains required.`
    );
  }
  if (expiredWaivers.length > 0) {
    effectiveWarnReasons.push(
      `Detected ${expiredWaivers.length} expired waiver(s) that were ignored.`
    );
  }
  if (invalidWaivers.length > 0) {
    effectiveWarnReasons.push(
      `Detected ${invalidWaivers.length} invalid waiver(s); see waiver audit for details.`
    );
  }

  const effectiveStatus: ReadinessGateStatus =
    effectiveStatusEvaluation.failReasons.length > 0
      ? "fail"
      : effectiveWarnReasons.length > 0
        ? "warn"
        : "pass";
  const statusReasons =
    effectiveStatus === "pass"
      ? ["All configured thresholds passed with no blockers or critical unsupported features."]
      : effectiveStatus === "fail"
        ? effectiveStatusEvaluation.failReasons
        : effectiveWarnReasons;
  const originalStatusReasons =
    originalStatusEvaluation.status === "pass"
      ? ["All configured thresholds passed with no blockers or critical unsupported features."]
      : originalStatusEvaluation.status === "fail"
        ? originalStatusEvaluation.failReasons
        : originalStatusEvaluation.warnReasons;
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
    status: effectiveStatus,
    originalStatus: originalStatusEvaluation.status,
    effectiveStatus,
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
    policy:
      policyProfile === null
        ? null
        : {
            schemaVersion: "1.0",
            profileName: policyProfile.profileName,
            description: policyProfile.description,
            requiredEvidence: policyProfile.requiredEvidence,
            metadata: policyProfile.metadata,
            sourcePolicyFile: input.sourcePolicyFile
          },
    waiverAudit: {
      appliedWaivers,
      expiredWaivers,
      invalidWaivers,
      waivedCount: appliedWaivers.length,
      expiredCount: expiredWaivers.length,
      invalidCount: invalidWaivers.length,
      nonWaivableBlockers
    },
    recommendations,
    statusReasons,
    originalStatusReasons
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
  lines.push(`- Effective status: **${gate.effectiveStatus.toUpperCase()}**`);
  lines.push(`- Original unwaived status: **${gate.originalStatus.toUpperCase()}**`);
  lines.push(`- Overall readiness: **${gate.overallReadiness}**`);
  lines.push(`- Risk score: **${gate.riskScore}**`);
  lines.push(`- Complexity score: **${gate.complexityScore}**`);
  lines.push(`- Confidence: **${gate.confidence.toFixed(2)}**`);
  lines.push(
    `- Waivers: applied=${gate.waiverAudit.waivedCount}, expired=${gate.waiverAudit.expiredCount}, invalid=${gate.waiverAudit.invalidCount}`
  );
  lines.push("");
  lines.push("## Policy context");
  lines.push("");
  if (gate.policy === null) {
    lines.push("- Policy: default built-in thresholds (no external policy file).");
  } else {
    lines.push(`- schemaVersion: ${gate.policy.schemaVersion}`);
    lines.push(`- profileName: ${gate.policy.profileName}`);
    lines.push(`- description: ${gate.policy.description}`);
    lines.push(
      `- sourcePolicyFile: ${gate.policy.sourcePolicyFile ?? "not provided"}`
    );
    lines.push(
      `- requiredEvidence: ${
        gate.policy.requiredEvidence.length > 0
          ? gate.policy.requiredEvidence.join(", ")
          : "none"
      }`
    );
  }
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
  lines.push("## Original unwaived reasons");
  lines.push("");
  listOrNone(gate.originalStatusReasons).forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## Waiver audit");
  lines.push("");
  lines.push(`- Applied waivers: ${gate.waiverAudit.waivedCount}`);
  lines.push(`- Expired waivers: ${gate.waiverAudit.expiredCount}`);
  lines.push(`- Invalid waivers: ${gate.waiverAudit.invalidCount}`);
  lines.push("");
  lines.push("### Applied waivers");
  lines.push("");
  listOrNone(
    gate.waiverAudit.appliedWaivers.map(
      (waiver) =>
        `${waiver.waiverId} -> ${waiver.targetType}:${waiver.targetId} [${waiver.severity}] (${waiver.category})`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("### Expired waivers");
  lines.push("");
  listOrNone(
    gate.waiverAudit.expiredWaivers.map(
      (waiver) => `${waiver.waiverId}: ${waiver.reason}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("### Invalid waivers");
  lines.push("");
  listOrNone(
    gate.waiverAudit.invalidWaivers.map(
      (waiver) => `${waiver.waiverId}: ${waiver.reason}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("### Non-waivable blockers");
  lines.push("");
  listOrNone(
    gate.waiverAudit.nonWaivableBlockers.map(
      (blocker) => `${blocker.targetType}:${blocker.targetId} — ${blocker.reason}`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Blockers");
  lines.push("");
  const waiverMap = gate.waiverAudit.appliedWaivers.reduce<Record<string, string[]>>(
    (accumulator, waiver) => {
      const key = `${waiver.targetType}:${waiver.targetId}`;
      accumulator[key] = [...(accumulator[key] ?? []), waiver.waiverId];
      return accumulator;
    },
    {}
  );
  listOrNone(
    gate.blockers.map((blocker) => {
      const waiverIds = waiverMap[`finding:${blocker.id}`] ?? [];
      return `[${blocker.severity}] ${blocker.title} — ${blocker.evidence}${
        waiverIds.length > 0 ? ` (waived by: ${waiverIds.join(", ")})` : ""
      }`;
    })
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Unresolved dependencies");
  lines.push("");
  listOrNone(
    gate.unresolvedDependencies.map(
      (dependency) =>
        `[${dependency.severity}] ${dependency.referenceType}:${dependency.referenceName} — ${dependency.message}${
          (waiverMap[`dependency:${dependency.id}`] ?? []).length > 0
            ? ` (waived by: ${(waiverMap[`dependency:${dependency.id}`] ?? []).join(", ")})`
            : ""
        }`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## High severity findings");
  lines.push("");
  listOrNone(
    gate.highSeverityFindings.map(
      (finding) =>
        `[${finding.severity}] ${finding.title} — ${finding.evidence}${
          (waiverMap[`finding:${finding.id}`] ?? []).length > 0
            ? ` (waived by: ${(waiverMap[`finding:${finding.id}`] ?? []).join(", ")})`
            : ""
        }`
    )
  ).forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");
  lines.push("## Unsupported features");
  lines.push("");
  listOrNone(
    gate.unsupportedFeatures.map(
      (feature) =>
        `[${feature.severity}] ${feature.featureType} at ${feature.sourceLocation} — ${feature.reason}${
          (waiverMap[`unsupported-feature:${unsupportedFeatureId(feature)}`] ?? []).length > 0
            ? ` (waived by: ${(
                waiverMap[`unsupported-feature:${unsupportedFeatureId(feature)}`] ?? []
              ).join(", ")})`
            : ""
        }`
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

export const renderReadinessGatePolicyMarkdown = (
  policyFile: ReadinessGatePolicyFile
): string => {
  const policy = readinessGatePolicyFileSchema.parse(policyFile);
  const lines: string[] = [];

  lines.push("# Power Exit Gate Policy Profiles");
  lines.push("");
  lines.push(`- schemaVersion: ${policy.schemaVersion}`);
  lines.push(`- description: ${policy.description}`);
  lines.push("");
  lines.push("## Profiles");
  lines.push("");
  for (const profile of sortByStableKey(policy.profiles, (entry) => entry.profileName)) {
    lines.push(`### ${profile.profileName}`);
    lines.push("");
    lines.push(`- Description: ${profile.description}`);
    lines.push(
      `- Thresholds: maxRisk=${profile.thresholds.maxRiskScore}, maxComplexity=${profile.thresholds.maxComplexityScore}, minConfidence=${profile.thresholds.minConfidence.toFixed(2)}, allowCriticalUnsupported=${profile.thresholds.allowCriticalUnsupported}, maxUnresolvedDependencies=${profile.thresholds.maxUnresolvedDependencies}, maxHighSeverityFindings=${profile.thresholds.maxHighSeverityFindings}, requireNoBlockers=${profile.thresholds.requireNoBlockers}`
    );
    lines.push(
      `- Waiver evidence requirements: ${
        profile.requiredEvidence.length > 0 ? profile.requiredEvidence.join(", ") : "none"
      }`
    );
    lines.push(
      `- Seed waivers: ${profile.allowedWaivers.length} (profile starts empty by default).`
    );
    lines.push("");
  }

  lines.push("## Governance notes");
  lines.push("");
  lines.push(
    "- Waivers are auditable records and do not remove evidence from readiness reports."
  );
  lines.push("- Expired and invalid waivers are ignored and surfaced as warnings.");
  lines.push("- Critical items require waiver.riskAccepted=true.");
  lines.push("- Prefer prod/strict profiles for CI merge or release gates.");

  return `${lines.join("\n")}\n`;
};

