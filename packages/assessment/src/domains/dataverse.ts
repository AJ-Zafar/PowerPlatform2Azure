import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type AssessmentDomainResult } from "../models";
import {
  averageConfidence,
  clampRiskScore,
  createAssessmentFinding,
  readinessFromScore,
  unsupportedByPrefix,
  warningsByCodes,
  warningsByPrefix
} from "../utils";

export const assessDataverse = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const entityCount = ir.dataverse.entities.length;
  const relationshipCount = ir.dataverse.relationships.length;
  const attributeCount = ir.dataverse.entities.reduce(
    (count, entity) => count + entity.attributes.length,
    0
  );
  const dataverseWarnings = warningsByPrefix(ir.warnings, "DATAVERSE_");
  const duplicateWarnings = warningsByCodes(ir.warnings, ["DATAVERSE_ENTITY_CONFLICT"]);
  const unresolvedRelationshipWarnings = warningsByCodes(ir.warnings, [
    "DATAVERSE_RELATIONSHIP_UNRESOLVED_TARGET_ENTITY"
  ]);
  const unsupportedDataverse = unsupportedByPrefix(ir.unsupportedFeatures, "dataverse.");
  const complexityLoad = Math.min(
    1,
    entityCount / 20 + relationshipCount / 25 + attributeCount / 350
  );
  const warningPenalty = Math.min(35, dataverseWarnings.length * 4);
  const unsupportedPenalty = Math.min(45, unsupportedDataverse.length * 7);
  const complexityPenalty = complexityLoad * 30;
  const score = clampRiskScore(100 - complexityPenalty - warningPenalty - unsupportedPenalty);
  const hasCriticalUnsupported = unsupportedDataverse.some(
    (feature) => feature.severity === "critical"
  );
  const findings = sortByStableKey(
    [
      ...(unsupportedDataverse.length > 0
        ? [
            createAssessmentFinding({
              id: "dataverse-unsupported-features",
              title: "Unsupported Dataverse metadata detected",
              description:
                "One or more Dataverse metadata features are unsupported and may require manual handling.",
              severity: unsupportedDataverse.some((feature) => feature.severity === "critical")
                ? "critical"
                : unsupportedDataverse.some((feature) => feature.severity === "high")
                  ? "high"
                  : "medium",
              category: "dataverse",
              affectedArtifactIds: sortByStableKey(
                ir.dataverse.entities.map((entity) => entity.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${unsupportedDataverse.length} unsupported Dataverse features found.`,
              recommendation:
                "Review unsupported Dataverse types and add explicit mapping/remediation rules before migration.",
              confidence: 0.85
            })
          ]
        : []),
      ...(unresolvedRelationshipWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "dataverse-unresolved-relationships",
              title: "Unresolved Dataverse relationships",
              description:
                "Some Dataverse relationships reference entities that were not resolved during parsing.",
              severity: "high",
              category: "dataverse",
              affectedArtifactIds: sortByStableKey(
                ir.dataverse.relationships.map((relationship) => relationship.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${unresolvedRelationshipWarnings.length} unresolved relationship warnings.`,
              recommendation:
                "Resolve missing relationship targets or include missing entity metadata before assessment reruns.",
              confidence: 0.8
            })
          ]
        : []),
      ...(duplicateWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "dataverse-conflicting-metadata",
              title: "Conflicting Dataverse entity metadata",
              description:
                "Duplicate or conflicting entity definitions were detected and reduce migration confidence.",
              severity: "medium",
              category: "dataverse",
              affectedArtifactIds: [],
              evidence: `${duplicateWarnings.length} metadata conflict warnings.`,
              recommendation:
                "Deduplicate entity metadata sources and keep a single authoritative entity definition per logical name.",
              confidence: 0.75
            })
          ]
        : []),
      ...(entityCount <= 8
        ? [
            createAssessmentFinding({
              id: "dataverse-low-volume-quick-win",
              title: "Low Dataverse schema volume",
              description:
                "Dataverse schema volume is relatively small and suitable for an early migration wave.",
              severity: "info",
              category: "dataverse",
              affectedArtifactIds: sortByStableKey(
                ir.dataverse.entities.map((entity) => entity.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${entityCount} entities and ${relationshipCount} relationships.`,
              recommendation:
                "Prioritize this schema in Wave 1 as a quick validation pass for data model migration.",
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
    [
      ...ir.dataverse.entities.map((entity) => entity.confidence),
      ...ir.dataverse.relationships.map((relationship) => relationship.confidence),
      ...ir.dataverse.optionSets.map((optionSet) => optionSet.confidence),
      ir.confidence
    ],
    ir.confidence
  );

  return {
    domain: "dataverse",
    score,
    readiness: readinessFromScore(score, hasCriticalUnsupported),
    findings,
    blockers,
    quickWins,
    confidence
  };
};
