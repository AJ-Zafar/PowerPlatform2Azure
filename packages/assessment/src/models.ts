import { z } from "zod";

import {
  artifactIdSchema,
  confidenceScoreSchema,
  sourceProvenanceSchema,
  sortByStableKey
} from "@power-exit/ir";

export const assessmentSeveritySchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical"
]);

export const assessmentReadinessSchema = z.enum(["high", "medium", "low", "blocked"]);

export const assessmentCategorySchema = z.enum([
  "dataverse",
  "canvas",
  "cloudFlows",
  "security",
  "connections",
  "dependencies",
  "general"
]);

export const assessmentDomainSchema = z.enum([
  "dataverse",
  "canvas",
  "cloudFlows",
  "security",
  "connections",
  "dependencies"
]);

export const assessmentFindingSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: assessmentSeveritySchema,
    category: assessmentCategorySchema,
    affectedArtifactIds: z.array(artifactIdSchema),
    evidence: z.string().min(1),
    recommendation: z.string().min(1),
    confidence: confidenceScoreSchema,
    provenance: sourceProvenanceSchema.optional()
  })
  .strict();

export const assessmentRecommendationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: assessmentSeveritySchema,
    relatedFindingIds: z.array(z.string().min(1)),
    affectedArtifactIds: z.array(artifactIdSchema),
    evidence: z.string().min(1)
  })
  .strict();

export const migrationWaveRecommendationSchema = z
  .object({
    waveId: z.enum(["wave-0", "wave-1", "wave-2", "wave-3", "wave-4"]),
    title: z.string().min(1),
    description: z.string().min(1),
    evidenceFindingIds: z.array(z.string().min(1)),
    evidenceArtifactIds: z.array(artifactIdSchema)
  })
  .strict();

export const assessmentDomainResultSchema = z
  .object({
    domain: assessmentDomainSchema,
    score: z.number().int().min(0).max(100),
    readiness: assessmentReadinessSchema,
    findings: z.array(assessmentFindingSchema),
    blockers: z.array(assessmentFindingSchema),
    quickWins: z.array(assessmentFindingSchema),
    confidence: confidenceScoreSchema
  })
  .strict();

export const domainAssessmentsSchema = z
  .object({
    dataverse: assessmentDomainResultSchema,
    canvas: assessmentDomainResultSchema,
    cloudFlows: assessmentDomainResultSchema,
    security: assessmentDomainResultSchema,
    connections: assessmentDomainResultSchema,
    dependencies: assessmentDomainResultSchema
  })
  .strict();

export const migrationAssessmentSchema = z
  .object({
    overallReadiness: assessmentReadinessSchema,
    overallRiskScore: z.number().int().min(0).max(100),
    overallComplexityScore: z.number().int().min(0).max(100),
    overallConfidence: confidenceScoreSchema,
    domainAssessments: domainAssessmentsSchema,
    findings: z.array(assessmentFindingSchema),
    recommendations: z.array(assessmentRecommendationSchema),
    blockers: z.array(assessmentFindingSchema),
    quickWins: z.array(assessmentFindingSchema),
    migrationWaves: z.array(migrationWaveRecommendationSchema)
  })
  .strict();

export type AssessmentSeverity = z.infer<typeof assessmentSeveritySchema>;
export type AssessmentReadiness = z.infer<typeof assessmentReadinessSchema>;
export type AssessmentCategory = z.infer<typeof assessmentCategorySchema>;
export type AssessmentDomain = z.infer<typeof assessmentDomainSchema>;
export type AssessmentFinding = z.infer<typeof assessmentFindingSchema>;
export type AssessmentRecommendation = z.infer<typeof assessmentRecommendationSchema>;
export type MigrationWaveRecommendation = z.infer<typeof migrationWaveRecommendationSchema>;
export type AssessmentDomainResult = z.infer<typeof assessmentDomainResultSchema>;
export type DomainAssessments = z.infer<typeof domainAssessmentsSchema>;
export type MigrationAssessment = z.infer<typeof migrationAssessmentSchema>;

const severityOrder: Record<AssessmentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

export const sortFindings = (findings: readonly AssessmentFinding[]): AssessmentFinding[] =>
  sortByStableKey(findings, (finding) =>
    `${severityOrder[finding.severity]}:${finding.category}:${finding.id}`
  );

export const validateMigrationAssessment = (input: unknown): MigrationAssessment =>
  migrationAssessmentSchema.parse(input);
