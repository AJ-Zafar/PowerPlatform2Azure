import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type AssessmentDomainResult } from "../models";
import {
  averageConfidence,
  clampRiskScore,
  createAssessmentFinding,
  readinessFromScore,
  unresolvedDependencyEdges
} from "../utils";

export const assessDependencies = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const unresolvedEdges = unresolvedDependencyEdges(ir);
  const unresolvedCount = unresolvedEdges.length;
  const flowUnresolvedCount = ir.analysisSummary.unresolvedFlowDependencies;
  const score = clampRiskScore(
    100 -
      Math.min(75, unresolvedCount * 4) -
      Math.min(30, flowUnresolvedCount * 2) -
      Math.min(15, ir.analysisSummary.unknownFiles * 2)
  );
  const hasDependencyBlocker = unresolvedCount >= 10;
  const findings = sortByStableKey(
    [
      ...(unresolvedCount > 0
        ? [
            createAssessmentFinding({
              id: "dependencies-unresolved-edges",
              title: "Unresolved dependency references",
              description:
                "Dependency graph contains unresolved references that increase migration risk.",
              severity: unresolvedCount >= 8 ? "high" : "medium",
              category: "dependencies",
              affectedArtifactIds: sortByStableKey(
                unresolvedEdges.flatMap((edge) => [edge.sourceArtifactId, edge.targetArtifactId]),
                (artifactId) => artifactId
              ),
              evidence: `${unresolvedCount} unresolved dependency edges (${flowUnresolvedCount} flow-related).`,
              recommendation:
                "Resolve missing references and rerun analysis before wave planning and execution.",
              confidence: 0.88
            })
          ]
        : []),
      ...(ir.analysisSummary.unknownFiles > 0
        ? [
            createAssessmentFinding({
              id: "dependencies-unknown-layouts",
              title: "Unknown source layouts reduce dependency confidence",
              description:
                "Unknown file layouts may contain hidden dependencies not represented in current IR.",
              severity: "medium",
              category: "dependencies",
              affectedArtifactIds: [],
              evidence: `${ir.analysisSummary.unknownFiles} unknown files in solution discovery.`,
              recommendation:
                "Classify unknown layouts or move files into recognized unpacked solution structure.",
              confidence: 0.78
            })
          ]
        : []),
      ...(unresolvedCount === 0 && ir.analysisSummary.unknownFiles === 0
        ? [
            createAssessmentFinding({
              id: "dependencies-clean-graph-quick-win",
              title: "Dependency graph is fully resolved",
              description:
                "No unresolved dependency edges were detected in the current migration graph.",
              severity: "info",
              category: "dependencies",
              affectedArtifactIds: [],
              evidence: "No unresolved edges and no unknown file layouts.",
              recommendation:
                "Use this dependency baseline to plan deterministic migration wave sequencing.",
              confidence: 0.72
            })
          ]
        : [])
    ],
    (finding) => finding.id
  );
  const blockers = findings.filter((finding) =>
    ["critical", "high"].includes(finding.severity)
  );
  const quickWins = findings.filter((finding) =>
    ["info", "low"].includes(finding.severity)
  );
  const confidence = averageConfidence(
    [
      ...ir.dependencyGraph.edges.map((edge) => edge.confidence),
      ir.confidence - Math.min(0.4, unresolvedCount * 0.01)
    ],
    ir.confidence
  );

  return {
    domain: "dependencies",
    score,
    readiness: readinessFromScore(score, hasDependencyBlocker),
    findings,
    blockers,
    quickWins,
    confidence
  };
};
