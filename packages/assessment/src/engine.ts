import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { assessCanvas } from "./domains/canvas";
import { assessConnections } from "./domains/connections";
import { assessDataverse } from "./domains/dataverse";
import { assessDependencies } from "./domains/dependencies";
import { assessFlows } from "./domains/flows";
import { assessSecurity } from "./domains/security";
import {
  type AssessmentDomainResult,
  type AssessmentFinding,
  type AssessmentRecommendation,
  type AssessmentReadiness,
  type DomainAssessments,
  type MigrationAssessment,
  type MigrationWaveRecommendation,
  sortFindings,
  validateMigrationAssessment
} from "./models";
import { clampConfidence, clampRiskScore, createAssessmentFinding } from "./utils";

const severityWeight: Record<AssessmentFinding["severity"], number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 0
};

const createGlobalFindings = (ir: PowerPlatformIR): AssessmentFinding[] => {
  const malformedWarnings = ir.warnings.filter(
    (warning) => warning.code.includes("INVALID") || warning.code.includes("MALFORMED")
  );
  const duplicateWarnings = ir.warnings.filter(
    (warning) => warning.code.includes("DUPLICATE") || warning.code.includes("CONFLICT")
  );
  const criticalUnsupported = ir.unsupportedFeatures.filter(
    (feature) => feature.severity === "critical"
  );
  const findings: AssessmentFinding[] = [];

  if (criticalUnsupported.length > 0) {
    findings.push(
      createAssessmentFinding({
        id: "global-critical-unsupported",
        title: "Critical unsupported features detected",
        description:
          "Critical unsupported features require architecture or process redesign before migration execution.",
        severity: "critical",
        category: "general",
        affectedArtifactIds: [],
        evidence: `${criticalUnsupported.length} critical unsupported features present.`,
        recommendation:
          "Resolve critical unsupported features in Wave 0 before scheduling downstream migration waves.",
        confidence: 0.9
      })
    );
  }

  if (ir.analysisSummary.unknownFiles > 0) {
    findings.push(
      createAssessmentFinding({
        id: "global-unknown-files",
        title: "Unknown file layouts reduce migration confidence",
        description:
          "Unknown files may hide unsupported features and unresolved dependencies outside current parser coverage.",
        severity: ir.analysisSummary.unknownFiles > 5 ? "high" : "medium",
        category: "general",
        affectedArtifactIds: [],
        evidence: `${ir.analysisSummary.unknownFiles} unknown files discovered.`,
        recommendation:
          "Classify or relocate unknown files into known unpacked solution patterns before final migration planning.",
        confidence: 0.8
      })
    );
  }

  if (malformedWarnings.length > 0) {
    findings.push(
      createAssessmentFinding({
        id: "global-malformed-artifacts",
        title: "Malformed artifacts detected during parsing",
        description:
          "Malformed source artifacts were detected and can mask functional behavior in migration planning.",
        severity: malformedWarnings.length > 8 ? "high" : "medium",
        category: "general",
        affectedArtifactIds: [],
        evidence: `${malformedWarnings.length} malformed/invalid artifact warnings.`,
        recommendation:
          "Fix malformed source artifacts and rerun analysis to improve confidence and reduce hidden risk.",
        confidence: 0.82
      })
    );
  }

  if (duplicateWarnings.length > 0) {
    findings.push(
      createAssessmentFinding({
        id: "global-duplicate-conflicts",
        title: "Duplicate or conflicting metadata detected",
        description:
          "Conflicting metadata definitions reduce deterministic migration behavior and confidence.",
        severity: "medium",
        category: "general",
        affectedArtifactIds: [],
        evidence: `${duplicateWarnings.length} duplicate/conflict warnings.`,
        recommendation:
          "Consolidate conflicting metadata sources and retain a single authoritative definition per artifact.",
        confidence: 0.76
      })
    );
  }

  return sortFindings(findings);
};

const calculateOverallComplexityScore = (
  ir: PowerPlatformIR,
  domainAssessments: DomainAssessments
): number => {
  const unresolvedEdgeCount = ir.dependencyGraph.edges.filter(
    (edge) => edge.resolved === false
  ).length;
  const criticalUnsupportedCount = ir.unsupportedFeatures.filter(
    (feature) => feature.severity === "critical"
  ).length;
  const domainPenalty =
    (100 - domainAssessments.dataverse.score) * 0.18 +
    (100 - domainAssessments.canvas.score) * 0.2 +
    (100 - domainAssessments.cloudFlows.score) * 0.2 +
    (100 - domainAssessments.security.score) * 0.14 +
    (100 - domainAssessments.connections.score) * 0.14 +
    (100 - domainAssessments.dependencies.score) * 0.14;
  const baseLoad =
    ir.analysisSummary.entities * 0.8 +
    ir.analysisSummary.relationships * 1.2 +
    ir.analysisSummary.canvasControls * 0.05 +
    ir.analysisSummary.flowActions * 0.35 +
    ir.analysisSummary.securityRoles * 1.4 +
    ir.analysisSummary.flowPremiumCustomConnectors * 2.2 +
    ir.analysisSummary.canvasLayoutWarnings * 1.4 +
    Math.max(ir.analysisSummary.unresolvedDependencies, unresolvedEdgeCount) * 1.5 +
    ir.analysisSummary.unknownFiles * 1.8 +
    ir.unsupportedFeatures.length * 1.4 +
    criticalUnsupportedCount * 6;

  return clampRiskScore(baseLoad + domainPenalty);
};

const calculateOverallRiskScore = (
  ir: PowerPlatformIR,
  domainAssessments: DomainAssessments,
  findings: readonly AssessmentFinding[]
): number => {
  const unresolvedEdgeCount = ir.dependencyGraph.edges.filter(
    (edge) => edge.resolved === false
  ).length;
  const unsupportedSeverityLoad = ir.unsupportedFeatures.reduce(
    (total, feature) => total + severityWeight[feature.severity],
    0
  );
  const blockedDomainCount = Object.values(domainAssessments).filter(
    (domain) => domain.readiness === "blocked"
  ).length;
  const warningLoad = ir.warnings.length * 0.65;
  const unresolvedLoad =
    Math.max(ir.analysisSummary.unresolvedDependencies, unresolvedEdgeCount) * 2.4;
  const flowRiskLoad =
    ir.analysisSummary.flowPremiumCustomConnectors * 3.5 +
    ir.analysisSummary.unresolvedFlowDependencies * 1.2;
  const canvasRiskLoad =
    ir.analysisSummary.canvasBlockedControls * 2.3 +
    ir.analysisSummary.canvasLayoutWarnings * 1.3 +
    ir.analysisSummary.canvasUnknownControls * 1.2;
  const evidenceLoad = findings.reduce(
    (total, finding) => total + severityWeight[finding.severity] * 0.35,
    0
  );

  return clampRiskScore(
    unsupportedSeverityLoad +
      warningLoad +
      unresolvedLoad +
      flowRiskLoad +
      canvasRiskLoad +
      blockedDomainCount * 12 +
      ir.analysisSummary.unknownFiles * 2.4 +
      evidenceLoad
  );
};

const calculateOverallConfidence = (
  ir: PowerPlatformIR,
  domainAssessments: DomainAssessments
): number => {
  const averageDomainConfidence =
    (domainAssessments.dataverse.confidence +
      domainAssessments.canvas.confidence +
      domainAssessments.cloudFlows.confidence +
      domainAssessments.security.confidence +
      domainAssessments.connections.confidence +
      domainAssessments.dependencies.confidence) /
    6;
  const unknownRatio =
    ir.analysisSummary.filesScanned > 0
      ? ir.analysisSummary.unknownFiles / ir.analysisSummary.filesScanned
      : 0;
  const uncertaintyPenalty = Math.min(
    0.4,
    unknownRatio * 0.25 +
      ir.analysisSummary.unresolvedDependencies * 0.008 +
      ir.warnings.filter(
        (warning) => warning.code.includes("INVALID") || warning.code.includes("MALFORMED")
      ).length *
        0.02 +
      ir.unsupportedFeatures.filter((feature) => feature.severity === "critical").length * 0.06
  );

  return clampConfidence(
    ir.confidence * 0.55 + averageDomainConfidence * 0.45 - uncertaintyPenalty
  );
};

const calculateOverallReadiness = (
  domainAssessments: DomainAssessments,
  riskScore: number,
  complexityScore: number,
  blockers: readonly AssessmentFinding[]
): AssessmentReadiness => {
  if (
    blockers.some((blocker) => blocker.severity === "critical") ||
    Object.values(domainAssessments).some((domain) => domain.readiness === "blocked")
  ) {
    return "blocked";
  }

  if (
    riskScore >= 72 ||
    complexityScore >= 72 ||
    Object.values(domainAssessments).some((domain) => domain.readiness === "low")
  ) {
    return "low";
  }

  if (riskScore >= 45 || complexityScore >= 45) {
    return "medium";
  }

  return "high";
};

const deriveRecommendations = (
  findings: readonly AssessmentFinding[],
  overallReadiness: AssessmentReadiness
): AssessmentRecommendation[] => {
  const recommendations = findings
    .filter((finding) => ["critical", "high", "medium"].includes(finding.severity))
    .map((finding): AssessmentRecommendation => ({
      id: `rec-${finding.id}`,
      title: finding.title,
      description: finding.recommendation,
      priority: finding.severity,
      relatedFindingIds: [finding.id],
      affectedArtifactIds: finding.affectedArtifactIds,
      evidence: finding.evidence
    }));

  if (overallReadiness === "blocked") {
    recommendations.push({
      id: "rec-blocked-wave-0",
      title: "Execute remediation-first migration wave",
      description:
        "Prioritize blocker remediation and dependency resolution before beginning conversion work.",
      priority: "critical",
      relatedFindingIds: findings
        .filter((finding) => ["critical", "high"].includes(finding.severity))
        .map((finding) => finding.id),
      affectedArtifactIds: sortByStableKey(
        findings.flatMap((finding) => finding.affectedArtifactIds),
        (artifactId) => artifactId
      ),
      evidence: "Overall readiness is blocked by high-severity findings."
    });
  }

  return sortByStableKey(recommendations, (recommendation) => recommendation.id);
};

const deriveMigrationWaves = (
  findings: readonly AssessmentFinding[],
  domainAssessments: DomainAssessments
): MigrationWaveRecommendation[] => {
  const blockers = findings.filter((finding) =>
    ["critical", "high"].includes(finding.severity)
  );
  const quickWins = findings.filter((finding) =>
    ["info", "low"].includes(finding.severity)
  );
  const canvasFlowComplexFindings = findings.filter((finding) =>
    ["canvas", "cloudFlows"].includes(finding.category)
  );

  return [
    {
      waveId: "wave-0",
      title: "Wave 0 — Discovery and remediation",
      description:
        "Resolve blockers, malformed artifacts, unsupported critical features, and unresolved dependencies.",
      evidenceFindingIds: blockers.map((finding) => finding.id),
      evidenceArtifactIds: sortByStableKey(
        blockers.flatMap((finding) => finding.affectedArtifactIds),
        (artifactId) => artifactId
      )
    },
    {
      waveId: "wave-1",
      title: "Wave 1 — Low-risk Dataverse/schema items",
      description:
        "Start with lower-risk Dataverse entities and relationships once blockers are addressed.",
      evidenceFindingIds: domainAssessments.dataverse.quickWins.map((finding) => finding.id),
      evidenceArtifactIds: sortByStableKey(
        domainAssessments.dataverse.quickWins.flatMap(
          (finding) => finding.affectedArtifactIds
        ),
        (artifactId) => artifactId
      )
    },
    {
      waveId: "wave-2",
      title: "Wave 2 — Simple flows and simple Canvas screens",
      description:
        "Migrate high-readiness Canvas screens and low-risk flows to validate target patterns.",
      evidenceFindingIds: quickWins.map((finding) => finding.id),
      evidenceArtifactIds: sortByStableKey(
        quickWins.flatMap((finding) => finding.affectedArtifactIds),
        (artifactId) => artifactId
      )
    },
    {
      waveId: "wave-3",
      title: "Wave 3 — Complex Canvas/Flow items",
      description:
        "Address complex layout/formula and orchestration cases requiring deeper redesign and validation.",
      evidenceFindingIds: canvasFlowComplexFindings.map((finding) => finding.id),
      evidenceArtifactIds: sortByStableKey(
        canvasFlowComplexFindings.flatMap((finding) => finding.affectedArtifactIds),
        (artifactId) => artifactId
      )
    },
    {
      waveId: "wave-4",
      title: "Wave 4 — Blocked/manual architecture decisions",
      description:
        "Handle residual blocked components with manual architecture decisions and explicit approvals.",
      evidenceFindingIds: blockers.map((finding) => finding.id),
      evidenceArtifactIds: sortByStableKey(
        blockers.flatMap((finding) => finding.affectedArtifactIds),
        (artifactId) => artifactId
      )
    }
  ];
};

const collectDomainAssessments = (ir: PowerPlatformIR): DomainAssessments => ({
  dataverse: assessDataverse(ir),
  canvas: assessCanvas(ir),
  cloudFlows: assessFlows(ir),
  security: assessSecurity(ir),
  connections: assessConnections(ir),
  dependencies: assessDependencies(ir)
});

const aggregateDomainFindings = (
  domains: readonly AssessmentDomainResult[]
): AssessmentFinding[] => sortFindings(domains.flatMap((domain) => domain.findings));

export const assessPowerPlatformIR = (ir: PowerPlatformIR): MigrationAssessment => {
  const domainAssessments = collectDomainAssessments(ir);
  const domainFindings = aggregateDomainFindings(Object.values(domainAssessments));
  const globalFindings = createGlobalFindings(ir);
  const findings = sortFindings([...domainFindings, ...globalFindings]);
  const blockers = sortFindings(
    findings.filter((finding) => ["critical", "high"].includes(finding.severity))
  );
  const quickWins = sortFindings(
    findings.filter((finding) => ["info", "low"].includes(finding.severity))
  );
  const overallComplexityScore = calculateOverallComplexityScore(ir, domainAssessments);
  const overallRiskScore = calculateOverallRiskScore(ir, domainAssessments, findings);
  const overallConfidence = calculateOverallConfidence(ir, domainAssessments);
  const overallReadiness = calculateOverallReadiness(
    domainAssessments,
    overallRiskScore,
    overallComplexityScore,
    blockers
  );
  const recommendations = deriveRecommendations(findings, overallReadiness);
  const migrationWaves = deriveMigrationWaves(findings, domainAssessments);

  return validateMigrationAssessment({
    overallReadiness,
    overallRiskScore,
    overallComplexityScore,
    overallConfidence,
    domainAssessments,
    findings,
    recommendations,
    blockers,
    quickWins,
    migrationWaves
  });
};
