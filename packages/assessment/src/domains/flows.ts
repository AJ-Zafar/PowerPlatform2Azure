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

export const assessFlows = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const flowCount = ir.cloudFlows.length;
  const blockedFlowCount = ir.analysisSummary.flowsByReadiness.blocked;
  const lowFlowCount = ir.analysisSummary.flowsByReadiness.low;
  const premiumConnectorCount = ir.analysisSummary.flowPremiumCustomConnectors;
  const unsupportedFlowFeatures = ir.analysisSummary.unsupportedFlowFeatures;
  const unresolvedFlowDependencies = ir.analysisSummary.unresolvedFlowDependencies;
  const flowWarnings = warningsByPrefix(ir.warnings, "FLOW_");
  const unsupportedFlows = unsupportedByPrefix(ir.unsupportedFeatures, "flow.");
  const loopWarnings = warningsByCodes(ir.warnings, [
    "FLOW_LOOP_ACTION",
    "FLOW_PARALLEL_BRANCHES",
    "FLOW_CHILD_FLOW_ACTION"
  ]);
  const humanActionWarnings = warningsByCodes(ir.warnings, ["FLOW_HUMAN_IN_THE_LOOP_ACTION"]);
  const httpWarnings = warningsByCodes(ir.warnings, [
    "FLOW_HTTP_ACTION",
    "FLOW_HTTP_OR_WEBHOOK_TRIGGER"
  ]);
  const complexityLoad = Math.min(
    1,
    blockedFlowCount / 8 +
      lowFlowCount / 20 +
      premiumConnectorCount / 10 +
      loopWarnings.length / 15 +
      humanActionWarnings.length / 10 +
      httpWarnings.length / 10 +
      unresolvedFlowDependencies / 20 +
      unsupportedFlowFeatures / 15
  );
  const warningPenalty = Math.min(45, flowWarnings.length * 3);
  const unsupportedPenalty = Math.min(45, unsupportedFlows.length * 7);
  const complexityPenalty = complexityLoad * 35;
  const score = clampRiskScore(100 - complexityPenalty - warningPenalty - unsupportedPenalty);
  const hasBlockedFlow = blockedFlowCount > 0;
  const hasCriticalUnsupported = unsupportedFlows.some((feature) => feature.severity === "critical");
  const findings = sortByStableKey(
    [
      ...(hasBlockedFlow
        ? [
            createAssessmentFinding({
              id: "flows-blocked-readiness",
              title: "Blocked cloud flows detected",
              description:
                "Some cloud flows are currently blocked due to unsupported or high-complexity features.",
              severity: "high",
              category: "cloudFlows",
              affectedArtifactIds: sortByStableKey(
                ir.cloudFlows.map((flow) => flow.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${blockedFlowCount} blocked flows and ${unsupportedFlowFeatures} unsupported flow features.`,
              recommendation:
                "Split blocked flows into manual redesign tasks and isolate them to late migration waves.",
              confidence: 0.85
            })
          ]
        : []),
      ...(premiumConnectorCount > 0
        ? [
            createAssessmentFinding({
              id: "flows-premium-custom-connectors",
              title: "Premium/custom connectors in cloud flows",
              description:
                "Premium or custom connectors increase migration complexity and target-platform dependency risk.",
              severity: "high",
              category: "cloudFlows",
              affectedArtifactIds: sortByStableKey(
                ir.cloudFlows.map((flow) => flow.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${premiumConnectorCount} premium/custom connectors detected.`,
              recommendation:
                "Inventory connector dependencies and define connector-specific replacement or integration strategies.",
              confidence: 0.82
            })
          ]
        : []),
      ...(httpWarnings.length > 0 || humanActionWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "flows-http-human-actions",
              title: "HTTP/webhook or human approval flow actions present",
              description:
                "HTTP/webhook and human-in-the-loop actions often require architecture decisions beyond simple migration.",
              severity: "medium",
              category: "cloudFlows",
              affectedArtifactIds: [],
              evidence: `${httpWarnings.length} HTTP/webhook warnings and ${humanActionWarnings.length} human-action warnings.`,
              recommendation:
                "Define integration and approval orchestration target patterns before migrating these flows.",
              confidence: 0.8
            })
          ]
        : []),
      ...(loopWarnings.length > 0
        ? [
            createAssessmentFinding({
              id: "flows-control-flow-complexity",
              title: "Complex flow control structures detected",
              description:
                "Loops, parallel branches, or child-flow orchestration increase migration complexity.",
              severity: "medium",
              category: "cloudFlows",
              affectedArtifactIds: [],
              evidence: `${loopWarnings.length} complex control-flow warnings.`,
              recommendation:
                "Model complex control flow as dedicated migration work items with explicit test coverage.",
              confidence: 0.78
            })
          ]
        : []),
      ...(flowCount > 0 && blockedFlowCount === 0 && premiumConnectorCount === 0
        ? [
            createAssessmentFinding({
              id: "flows-simple-quick-win",
              title: "Simple cloud flows available for early migration",
              description:
                "A subset of flows appear low-risk and suitable for early migration validation.",
              severity: "info",
              category: "cloudFlows",
              affectedArtifactIds: sortByStableKey(
                ir.cloudFlows.map((flow) => flow.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${flowCount} total flows with no blocked or premium connector signals.`,
              recommendation:
                "Use simple flows in Wave 2 to validate orchestration and observability patterns.",
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
    [...ir.cloudFlows.map((flow) => flow.confidence), ir.confidence],
    ir.confidence
  );
  const readiness = hasBlockedFlow
    ? "blocked"
    : readinessFromScore(score, hasCriticalUnsupported);

  return {
    domain: "cloudFlows",
    score,
    readiness,
    findings,
    blockers,
    quickWins,
    confidence
  };
};
