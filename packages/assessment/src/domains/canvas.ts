import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type AssessmentDomainResult } from "../models";
import {
  averageConfidence,
  clampRiskScore,
  createAssessmentFinding,
  readinessFromScore,
  unsupportedByPrefix,
  warningsByPrefix
} from "../utils";

export const assessCanvas = (ir: PowerPlatformIR): AssessmentDomainResult => {
  const canvasApps = ir.canvasApps;
  const screenReadiness = ir.analysisSummary.canvasScreensByReadiness;
  const blockedControls = ir.analysisSummary.canvasBlockedControls;
  const unknownControls = ir.analysisSummary.canvasUnknownControls;
  const complexFormulas = ir.analysisSummary.canvasComplexFormulas;
  const layoutWarnings = ir.analysisSummary.canvasLayoutWarnings;
  const htmlControlCount = canvasApps.reduce(
    (count, app) =>
      count +
      app.screens.reduce(
        (screenCount, screen) =>
          screenCount + screen.controls.filter((control) => control.role === "html").length,
        0
      ),
    0
  );
  const customComponentCount = canvasApps.reduce(
    (count, app) =>
      count +
      app.screens.reduce(
        (screenCount, screen) =>
          screenCount +
          screen.controls.filter((control) => control.role === "customComponent").length,
        0
      ),
    0
  );
  const canvasWarnings = warningsByPrefix(ir.warnings, "CANVAS_");
  const unsupportedCanvas = unsupportedByPrefix(ir.unsupportedFeatures, "canvas.");
  const blockedScreens = screenReadiness.blocked;
  const lowScreens = screenReadiness.low;
  const complexityLoad = Math.min(
    1,
    blockedControls / 20 +
      complexFormulas / 20 +
      layoutWarnings / 15 +
      unknownControls / 25 +
      htmlControlCount / 10 +
      customComponentCount / 10
  );
  const warningPenalty = Math.min(40, canvasWarnings.length * 3);
  const unsupportedPenalty = Math.min(40, unsupportedCanvas.length * 6);
  const readinessPenalty = Math.min(30, blockedScreens * 10 + lowScreens * 4);
  const score = clampRiskScore(
    100 - complexityLoad * 35 - warningPenalty - unsupportedPenalty - readinessPenalty
  );
  const hasCriticalUnsupported = unsupportedCanvas.some(
    (feature) => feature.severity === "critical"
  );
  const hasBlockedCanvas = blockedScreens > 0 || blockedControls > 0;
  const findings = sortByStableKey(
    [
      ...(hasBlockedCanvas
        ? [
            createAssessmentFinding({
              id: "canvas-blocked-readiness",
              title: "Canvas assets include blocked readiness items",
              description:
                "One or more Canvas screens or controls are flagged as blocked for direct migration.",
              severity: "high",
              category: "canvas",
              affectedArtifactIds: sortByStableKey(
                canvasApps.map((app) => app.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${blockedScreens} blocked screens and ${blockedControls} blocked controls.`,
              recommendation:
                "Address blocked controls and formula/data-binding issues before UI migration planning.",
              confidence: 0.85
            })
          ]
        : []),
      ...(htmlControlCount > 0 || customComponentCount > 0
        ? [
            createAssessmentFinding({
              id: "canvas-html-custom-components",
              title: "Canvas HTML/custom component usage detected",
              description:
                "HTML text controls or custom components require manual UX and component mapping decisions.",
              severity: "medium",
              category: "canvas",
              affectedArtifactIds: sortByStableKey(
                canvasApps.map((app) => app.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${htmlControlCount} html controls and ${customComponentCount} custom components.`,
              recommendation:
                "Define reusable React component mappings and manual UX fallback rules for HTML-based controls.",
              confidence: 0.8
            })
          ]
        : []),
      ...(layoutWarnings > 0
        ? [
            createAssessmentFinding({
              id: "canvas-layout-risk",
              title: "Absolute-heavy or complex canvas layouts",
              description:
                "Layout normalization detected risk patterns that often require manual responsive redesign.",
              severity: "medium",
              category: "canvas",
              affectedArtifactIds: [],
              evidence: `${layoutWarnings} layout warnings and ${complexFormulas} complex formulas.`,
              recommendation:
                "Prioritize responsive layout remediation for high-risk screens before conversion planning.",
              confidence: 0.78
            })
          ]
        : []),
      ...(unsupportedCanvas.length > 0
        ? [
            createAssessmentFinding({
              id: "canvas-unsupported-features",
              title: "Unsupported Canvas features detected",
              description:
                "Some Canvas controls/properties are unsupported and reduce automated migration readiness.",
              severity: unsupportedCanvas.some((feature) => feature.severity === "high")
                ? "high"
                : "medium",
              category: "canvas",
              affectedArtifactIds: [],
              evidence: `${unsupportedCanvas.length} unsupported Canvas features.`,
              recommendation:
                "Define manual migration actions for unsupported controls and property shapes.",
              confidence: 0.82
            })
          ]
        : []),
      ...(screenReadiness.high > 0
        ? [
            createAssessmentFinding({
              id: "canvas-high-readiness-quick-win",
              title: "High-readiness Canvas screens available",
              description:
                "A subset of Canvas screens are already in high-readiness state and can be scheduled early.",
              severity: "info",
              category: "canvas",
              affectedArtifactIds: sortByStableKey(
                canvasApps.map((app) => app.artifactId),
                (artifactId) => artifactId
              ),
              evidence: `${screenReadiness.high} high-readiness screens.`,
              recommendation:
                "Use high-readiness screens in Wave 2 to validate front-end migration patterns quickly.",
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
      ...canvasApps.map((app) => app.confidence),
      ...canvasApps.flatMap((app) => app.screens.map((screen) => screen.confidence)),
      ir.confidence
    ],
    ir.confidence
  );
  const readiness = hasBlockedCanvas
    ? "blocked"
    : readinessFromScore(score, hasCriticalUnsupported);

  return {
    domain: "canvas",
    score,
    readiness,
    findings,
    blockers,
    quickWins,
    confidence
  };
};
