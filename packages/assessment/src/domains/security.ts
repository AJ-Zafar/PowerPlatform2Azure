import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type AssessmentDomainResult } from "../models";
import {
  averageConfidence,
  clampRiskScore,
  createAssessmentFinding,
  readinessFromScore,
  warningsByCodes
} from "../utils";

export const assessSecurity = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const roleCount = ir.security.roles.length;
  const privilegeCount = ir.security.roles.reduce(
    (count, role) => count + role.privileges.length,
    0
  );
  const unresolvedPrivilegeWarnings = warningsByCodes(ir.warnings, [
    "SECURITY_ROLE_UNRESOLVED_PRIVILEGE",
    "SECURITY_ROLE_UNRESOLVED_PRIVILEGE_ENTITY",
    "DEPENDENCY_UNRESOLVED_SECURITY_PRIVILEGE"
  ]);
  const complexityLoad = Math.min(
    1,
    roleCount / 20 + privilegeCount / 300 + unresolvedPrivilegeWarnings.length / 30
  );
  const score = clampRiskScore(
    100 - complexityLoad * 45 - Math.min(40, unresolvedPrivilegeWarnings.length * 6)
  );
  const hasSecurityBlocker = unresolvedPrivilegeWarnings.length >= 8;
  const findings = sortByStableKey(
    [
      ...(unresolvedPrivilegeWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "security-unresolved-privileges",
              title: "Unresolved security privilege mappings",
              description:
                "Security role privilege mappings include unresolved or ambiguous entity references.",
              severity: unresolvedPrivilegeWarnings.length > 6 ? "high" : "medium",
              category: "security",
              affectedArtifactIds: sortByStableKey(
                ir.security.roles.map((role) => role.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${unresolvedPrivilegeWarnings.length} unresolved privilege warnings.`,
              recommendation:
                "Resolve unresolved security privilege entities and confirm target authorization model.",
              confidence: 0.8
            })
          ]
        : []),
      ...(roleCount > 0 && privilegeCount / Math.max(roleCount, 1) > 18
        ? [
            createAssessmentFinding({
              id: "security-high-privilege-density",
              title: "High security privilege density",
              description:
                "Average privilege count per role is high and may complicate role migration and validation.",
              severity: "medium",
              category: "security",
              affectedArtifactIds: sortByStableKey(
                ir.security.roles.map((role) => role.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${roleCount} roles with ${privilegeCount} total privileges.`,
              recommendation:
                "Group roles by functional domains and create phased privilege validation tests.",
              confidence: 0.75
            })
          ]
        : []),
      ...(roleCount <= 3 && unresolvedPrivilegeWarnings.length === 0
        ? [
            createAssessmentFinding({
              id: "security-low-volume-quick-win",
              title: "Small security role footprint",
              description:
                "Security inventory is relatively small and suitable for early migration validation.",
              severity: "info",
              category: "security",
              affectedArtifactIds: sortByStableKey(
                ir.security.roles.map((role) => role.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${roleCount} security roles identified.`,
              recommendation:
                "Include these roles in an early security validation wave after schema migration.",
              confidence: 0.68
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
      ...ir.security.roles.map((role) => role.confidence),
      ...ir.security.roles.flatMap((role) =>
        role.privileges.map((privilege) => privilege.confidence)
      ),
      ir.confidence
    ],
    ir.confidence
  );

  return {
    domain: "security",
    score,
    readiness: readinessFromScore(score, hasSecurityBlocker),
    findings,
    blockers,
    quickWins,
    confidence
  };
};
