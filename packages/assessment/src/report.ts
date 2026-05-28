import { sortByStableKey, type PowerPlatformIR } from "@power-exit/ir";

import { type MigrationAssessment } from "./models";

const formatScore = (value: number): string => `${value}/100`;
const formatConfidence = (value: number): string => value.toFixed(2);

const sectionList = (items: readonly string[]): string =>
  items.length === 0 ? "- None." : items.map((item) => `- ${item}`).join("\n");

const findingsSection = (
  title: string,
  findings: readonly MigrationAssessment["findings"][number][]
): string => {
  const ordered = sortByStableKey(findings, (finding) => `${finding.severity}:${finding.id}`);
  if (ordered.length === 0) {
    return `### ${title}\n\n- None.\n`;
  }

  return [
    `### ${title}`,
    "",
    ...ordered.map(
      (finding) =>
        `- **${finding.title}** (${finding.severity}) — ${finding.description} Evidence: ${finding.evidence} Recommendation: ${finding.recommendation}`
    ),
    ""
  ].join("\n");
};

const domainSummaryLine = (
  domainLabel: string,
  domain: MigrationAssessment["domainAssessments"][keyof MigrationAssessment["domainAssessments"]]
): string =>
  `- **${domainLabel}**: readiness **${domain.readiness}**, score **${formatScore(domain.score)}**, confidence **${formatConfidence(domain.confidence)}**.`;

export const generateAssessmentReportMarkdown = (
  ir: PowerPlatformIR,
  assessment: MigrationAssessment
): string => {
  const unsupportedSummary = sortByStableKey(
    ir.unsupportedFeatures.map(
      (feature) =>
        `${feature.featureType} (${feature.severity}) at \`${feature.sourceLocation}\` — ${feature.reason}`
    ),
    (entry) => entry
  );
  const warningSummary = sortByStableKey(
    ir.warnings.map(
      (warning) =>
        `${warning.code} (${warning.severity}) at \`${warning.sourceLocation}\` — ${warning.message}`
    ),
    (entry) => entry
  );
  const blockers = assessment.blockers;
  const quickWins = assessment.quickWins;
  const nextSteps = [
    "Validate blocker remediation scope and ownership.",
    "Confirm migration wave sequencing with engineering and platform teams.",
    "Rerun `power-exit analyse --report` after remediation to refresh readiness/risk outputs."
  ];

  return [
    "# Power Exit Migration Assessment Report",
    "",
    "## Executive summary",
    `- Overall readiness: **${assessment.overallReadiness}**.`,
    `- Overall risk score: **${formatScore(assessment.overallRiskScore)}**.`,
    `- Overall complexity score: **${formatScore(assessment.overallComplexityScore)}**.`,
    `- Overall confidence: **${formatConfidence(assessment.overallConfidence)}**.`,
    "",
    "## Overall readiness",
    `- Readiness state: **${assessment.overallReadiness}**.`,
    `- Blockers identified: **${blockers.length}**.`,
    `- Quick wins identified: **${quickWins.length}**.`,
    "",
    "## Overall risk/complexity/confidence",
    `- Risk: **${formatScore(assessment.overallRiskScore)}**.`,
    `- Complexity: **${formatScore(assessment.overallComplexityScore)}**.`,
    `- Confidence: **${formatConfidence(assessment.overallConfidence)}**.`,
    "",
    "## Key blockers",
    sectionList(blockers.map((blocker) => `${blocker.title} — ${blocker.evidence}`)),
    "",
    "## Quick wins",
    sectionList(quickWins.map((quickWin) => `${quickWin.title} — ${quickWin.recommendation}`)),
    "",
    "## Dataverse assessment",
    domainSummaryLine("Dataverse", assessment.domainAssessments.dataverse),
    findingsSection(
      "Dataverse findings",
      assessment.findings.filter((finding) => finding.category === "dataverse")
    ),
    "## Canvas assessment",
    domainSummaryLine("Canvas", assessment.domainAssessments.canvas),
    findingsSection(
      "Canvas findings",
      assessment.findings.filter((finding) => finding.category === "canvas")
    ),
    "## Cloud Flow assessment",
    domainSummaryLine("Cloud Flows", assessment.domainAssessments.cloudFlows),
    findingsSection(
      "Cloud Flow findings",
      assessment.findings.filter((finding) => finding.category === "cloudFlows")
    ),
    "## Security assessment",
    domainSummaryLine("Security", assessment.domainAssessments.security),
    findingsSection(
      "Security findings",
      assessment.findings.filter((finding) => finding.category === "security")
    ),
    "## Connection and dependency assessment",
    domainSummaryLine("Connections", assessment.domainAssessments.connections),
    domainSummaryLine("Dependencies", assessment.domainAssessments.dependencies),
    findingsSection(
      "Connection/dependency findings",
      assessment.findings.filter((finding) =>
        ["connections", "dependencies"].includes(finding.category)
      )
    ),
    "## Unsupported features",
    sectionList(unsupportedSummary),
    "",
    "## Warnings",
    sectionList(warningSummary),
    "",
    "## Recommended migration waves",
    ...assessment.migrationWaves.map((wave) =>
      [
        `### ${wave.title}`,
        `- Description: ${wave.description}`,
        `- Evidence findings: ${
          wave.evidenceFindingIds.length > 0 ? wave.evidenceFindingIds.join(", ") : "None"
        }`,
        `- Evidence artifacts: ${
          wave.evidenceArtifactIds.length > 0
            ? wave.evidenceArtifactIds.map((artifactId) => `\`${artifactId}\``).join(", ")
            : "None"
        }`,
        ""
      ].join("\n")
    ),
    "## Next steps",
    sectionList(nextSteps),
    ""
  ].join("\n");
};
