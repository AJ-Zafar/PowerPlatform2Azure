import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type AssessmentDomainResult } from "../models";
import {
  averageConfidence,
  clampRiskScore,
  createAssessmentFinding,
  readinessFromScore,
  warningsByCodes
} from "../utils";

export const assessConnections = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const connectionCount = ir.connectionReferences.length;
  const premiumCustomConnectorCount = ir.analysisSummary.flowPremiumCustomConnectors;
  const missingConnectionWarnings = warningsByCodes(ir.warnings, [
    "FLOW_MISSING_CONNECTION_REFERENCE",
    "DEPENDENCY_UNRESOLVED_FLOW_CONNECTION_REFERENCE",
    "DEPENDENCY_UNRESOLVED_CONNECTION_REFERENCE"
  ]);
  const complexityLoad = Math.min(
    1,
    connectionCount / 20 +
      premiumCustomConnectorCount / 12 +
      missingConnectionWarnings.length / 20
  );
  const score = clampRiskScore(
    100 -
      complexityLoad * 35 -
      Math.min(40, premiumCustomConnectorCount * 7) -
      Math.min(40, missingConnectionWarnings.length * 5)
  );
  const hasConnectionBlocker = missingConnectionWarnings.length > 4;
  const findings = sortByStableKey(
    [
      ...(missingConnectionWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "connections-missing-references",
              title: "Missing connection references",
              description:
                "Some flow actions reference missing or unresolved connection references.",
              severity: missingConnectionWarnings.length > 5 ? "high" : "medium",
              category: "connections",
              affectedArtifactIds: sortByStableKey(
                ir.connectionReferences.map((reference) => reference.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${missingConnectionWarnings.length} missing connection reference warnings.`,
              recommendation:
                "Reconcile connection reference names with flow definitions before migration planning.",
              confidence: 0.84
            })
          ]
        : []),
      ...(premiumCustomConnectorCount > 0
        ? [
            createAssessmentFinding({
              id: "connections-premium-custom",
              title: "Premium/custom connection footprint",
              description:
                "Premium or custom connectors increase integration risk and may require manual target integration work.",
              severity: "high",
              category: "connections",
              affectedArtifactIds: sortByStableKey(
                ir.connectionReferences.map((reference) => reference.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${premiumCustomConnectorCount} premium/custom connectors detected in flow summary.`,
              recommendation:
                "Create connector-specific migration runbooks and validate equivalent target integrations early.",
              confidence: 0.8
            })
          ]
        : []),
      ...(connectionCount <= 2 && missingConnectionWarnings.length === 0
        ? [
            createAssessmentFinding({
              id: "connections-low-volume-quick-win",
              title: "Small connection reference inventory",
              description:
                "Connection inventory is small enough for quick reconciliation and early migration validation.",
              severity: "info",
              category: "connections",
              affectedArtifactIds: sortByStableKey(
                ir.connectionReferences.map((reference) => reference.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${connectionCount} connection references.`,
              recommendation:
                "Complete connection mapping in Wave 0 to de-risk downstream flow migration work.",
              confidence: 0.7
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
    [...ir.connectionReferences.map((reference) => reference.confidence), ir.confidence],
    ir.confidence
  );

  return {
    domain: "connections",
    score,
    readiness: readinessFromScore(score, hasConnectionBlocker),
    findings,
    blockers,
    quickWins,
    confidence
  };
};
