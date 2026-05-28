#!/usr/bin/env node
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeDeterministicIR, validatePowerPlatformIR } from "@power-exit/ir";
import {
  assessPowerPlatformIR,
  generateAssessmentReportMarkdown
} from "@power-exit/assessment";
import {
  generateCanvasReactFromPowerPlatformIR,
  generateDataverseSqlFromPowerPlatformIR,
  hasGeneratedFileMarker,
  planGeneration,
  renderGenerationPlanMarkdown,
  serializeGenerationPlan,
  type ExistingFileState,
  type GenerationManualReviewItem
} from "@power-exit/generators";
import { analyseSolutionFolder } from "@power-exit/parsers";

type WriteFn = (line: string) => void;

class CliError extends Error {
  public readonly code: string;

  public readonly details?: Record<string, string>;

  public constructor(
    code: string,
    message: string,
    details?: Record<string, string>
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface AnalyseArgs {
  solutionFolder: string;
  outputFolder: string;
  includeReport: boolean;
}

interface ReportArgs {
  irFilePath: string;
  outputFolder: string;
}

interface GenerateSqlArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

interface GenerateReactArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

const parseAnalyseArgs = (args: string[]): AnalyseArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit analyse <solution-folder> --out <output-folder>"
    );
  }

  const [solutionFolder, ...flags] = args;
  let outputFolder: string | undefined;
  let includeReport = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--report") {
      includeReport = true;
      continue;
    }

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    solutionFolder: path.resolve(solutionFolder),
    outputFolder: path.resolve(outputFolder),
    includeReport
  };
};

const parseReportArgs = (args: string[]): ReportArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit report <ir-json> --out <output-folder>"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder)
  };
};

const parseGenerateSqlArgs = (args: string[]): GenerateSqlArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate sql <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const parseGenerateReactArgs = (args: string[]): GenerateReactArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate react <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const ensureInputFolder = async (solutionFolder: string): Promise<void> => {
  let metadata;

  try {
    metadata = await stat(solutionFolder);
  } catch {
    throw new CliError("INPUT_FOLDER_NOT_FOUND", "Solution folder does not exist.", {
      solutionFolder
    });
  }

  if (!metadata.isDirectory()) {
    throw new CliError("INPUT_FOLDER_NOT_FOUND", "Solution path is not a folder.", {
      solutionFolder
    });
  }
};

const ensureInputFile = async (inputFilePath: string): Promise<void> => {
  let metadata;

  try {
    metadata = await stat(inputFilePath);
  } catch {
    throw new CliError("INPUT_FILE_NOT_FOUND", "Input file does not exist.", {
      inputFilePath
    });
  }

  if (!metadata.isFile()) {
    throw new CliError("INPUT_FILE_NOT_FOUND", "Input path is not a file.", {
      inputFilePath
    });
  }
};

const ensureOutputFolder = async (outputFolder: string): Promise<void> => {
  try {
    await mkdir(outputFolder, { recursive: true });
    const metadata = await stat(outputFolder);

    if (!metadata.isDirectory()) {
      throw new CliError(
        "INVALID_OUTPUT_PATH",
        "Output path exists and is not a folder.",
        {
          outputFolder
        }
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError("INVALID_OUTPUT_PATH", "Could not create output folder.", {
      outputFolder
    });
  }
};

const cleanGeneratedFiles = async (targetFolder: string): Promise<void> => {
  let entries;
  try {
    entries = await readdir(targetFolder, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(targetFolder, entry.name);
    if (entry.isDirectory()) {
      await cleanGeneratedFiles(entryPath);
      try {
        await rmdir(entryPath);
      } catch {
        // Keep non-empty directories.
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    try {
      const content = await readFile(entryPath, "utf-8");
      if (hasGeneratedFileMarker(content)) {
        await unlink(entryPath);
      }
    } catch {
      // Non-text files and read/delete errors are intentionally ignored in clean mode.
    }
  }
};

const loadExistingFiles = async (
  outputFolder: string,
  artifactPaths: string[]
): Promise<ExistingFileState[]> => {
  const existingFiles: ExistingFileState[] = [];

  for (const artifactPath of artifactPaths) {
    const absolutePath = path.join(outputFolder, artifactPath);
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) {
        continue;
      }
      existingFiles.push({
        path: artifactPath,
        content: await readFile(absolutePath, "utf-8")
      });
    } catch {
      // Missing files are expected and excluded from existing snapshot.
    }
  }

  return existingFiles;
};

const writePlannedArtifacts = async (
  outputFolder: string,
  writes: Array<{ path: string; content: string }>
): Promise<void> => {
  for (const writeEntry of writes) {
    const outputPath = path.join(outputFolder, writeEntry.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, writeEntry.content, "utf-8");
  }
};

const writeGenerationPlanFiles = async (
  outputFolder: string,
  jsonContent: string,
  markdownContent: string
): Promise<void> => {
  await writeFile(path.join(outputFolder, "generation-plan.json"), jsonContent, "utf-8");
  await writeFile(path.join(outputFolder, "generation-plan.md"), markdownContent, "utf-8");
};

const warningSeverityToReviewSeverity = (
  warningCode: string
): GenerationManualReviewItem["severity"] =>
  warningCode.includes("UNSUPPORTED") || warningCode.includes("COMPLEXITY")
    ? "medium"
    : "low";

const buildManualReviewItems = (input: {
  warnings: Array<{ code: string; message: string; sourceArtifactIds: string[] }>;
  unsupportedFeatures: Array<{
    featureType: string;
    reason: string;
    severity: GenerationManualReviewItem["severity"];
    sourceArtifactIds: string[];
  }>;
  formulaHotspots?: Array<{
    generatedStubName: string;
    recommendation: string;
    severity: GenerationManualReviewItem["severity"];
    screen: string;
    control: string | null;
    property: string;
  }>;
}): GenerationManualReviewItem[] => {
  const reviewItems: GenerationManualReviewItem[] = [];

  input.warnings.forEach((warning) => {
    reviewItems.push({
      id: `review:warning:${warning.code}:${warning.message}`,
      category: "warning",
      severity: warningSeverityToReviewSeverity(warning.code),
      message: warning.message,
      relatedPaths: [],
      sourceArtifactIds: warning.sourceArtifactIds
    });
  });

  input.unsupportedFeatures.forEach((feature) => {
    reviewItems.push({
      id: `review:unsupported:${feature.featureType}:${feature.reason}`,
      category: "unsupported-feature",
      severity: feature.severity,
      message: feature.reason,
      relatedPaths: [],
      sourceArtifactIds: feature.sourceArtifactIds
    });
  });

  (input.formulaHotspots ?? []).forEach((hotspot) => {
    reviewItems.push({
      id: `review:formula-hotspot:${hotspot.generatedStubName}`,
      category: "formula-hotspot",
      severity: hotspot.severity,
      message: hotspot.recommendation,
      relatedPaths: [
        `${hotspot.screen}:${hotspot.control ?? "(screen)"}:${hotspot.property}`
      ],
      sourceArtifactIds: []
    });
  });

  return reviewItems;
};

const executeAnalyse = async (
  args: string[],
  stdout: WriteFn
): Promise<void> => {
  const parsedArgs = parseAnalyseArgs(args);

  await ensureInputFolder(parsedArgs.solutionFolder);
  await ensureOutputFolder(parsedArgs.outputFolder);
  const analysis = await analyseSolutionFolder(parsedArgs.solutionFolder);
  let validatedIr;

  try {
    validatedIr = validatePowerPlatformIR(analysis.ir);
  } catch {
    throw new CliError(
      "IR_VALIDATION_FAILURE",
      "Generated IR failed schema validation."
    );
  }

  const serializedIr = `${serializeDeterministicIR(validatedIr)}\n`;
  const outputFile = path.join(parsedArgs.outputFolder, "ir.json");
  const reportFile = path.join(parsedArgs.outputFolder, "assessment-report.md");

  await writeFile(outputFile, serializedIr, "utf-8");

  if (parsedArgs.includeReport) {
    const assessment = assessPowerPlatformIR(validatedIr);
    const report = generateAssessmentReportMarkdown(validatedIr, assessment);
    await writeFile(reportFile, `${report}\n`, "utf-8");
  }

  stdout(
    JSON.stringify({
      command: "analyse",
      status: "success",
      solutionFolder: parsedArgs.solutionFolder,
      outputFile,
      filesScanned: analysis.summary.filesScanned,
      classifiedFiles: analysis.summary.classifiedFiles,
      unknownFiles: analysis.summary.unknownFiles,
      solutionMetadataFound: analysis.summary.solutionMetadataFound,
      entitiesParsed: analysis.summary.entitiesParsed,
      attributesParsed: analysis.summary.attributesParsed,
      relationshipsParsed: analysis.summary.relationshipsParsed,
      choicesParsed: analysis.summary.choicesParsed,
      canvasAppsParsed: analysis.summary.canvasAppsParsed,
      canvasScreensParsed: analysis.summary.canvasScreensParsed,
      canvasControlsParsed: analysis.summary.canvasControlsParsed,
      canvasFormulasParsed: analysis.summary.canvasFormulasParsed,
      canvasScreensByReadiness: analysis.summary.canvasScreensByReadiness,
      canvasControlsByRole: analysis.summary.canvasControlsByRole,
      canvasBlockedControls: analysis.summary.canvasBlockedControls,
      canvasUnknownControls: analysis.summary.canvasUnknownControls,
      canvasComplexFormulas: analysis.summary.canvasComplexFormulas,
      canvasLayoutWarnings: analysis.summary.canvasLayoutWarnings,
      flowsParsed: analysis.summary.flowsParsed,
      triggersParsed: analysis.summary.triggersParsed,
      actionsParsed: analysis.summary.actionsParsed,
      connectorsDetected: analysis.summary.connectorsDetected,
      premiumCustomConnectors: analysis.summary.premiumCustomConnectors,
      flowsByReadiness: analysis.summary.flowsByReadiness,
      unsupportedFlowFeatures: analysis.summary.unsupportedFlowFeatures,
      unresolvedFlowDependencies: analysis.summary.unresolvedFlowDependencies,
      environmentVariables: analysis.summary.environmentVariables,
      connectionReferences: analysis.summary.connectionReferences,
      securityRoles: analysis.summary.securityRoles,
      warnings: validatedIr.warnings.length,
      unsupportedFeatures: validatedIr.unsupportedFeatures.length,
      unsupported: validatedIr.unsupportedFeatures.length,
      unresolvedDependencies: analysis.summary.unresolvedDependencies,
      confidence: validatedIr.confidence,
      reportGenerated: parsedArgs.includeReport,
      reportFile: parsedArgs.includeReport ? reportFile : undefined
    })
  );
};

const executeReport = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseReportArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const assessment = assessPowerPlatformIR(validatedIr);
  const report = generateAssessmentReportMarkdown(validatedIr, assessment);
  const reportFile = path.join(parsedArgs.outputFolder, "assessment-report.md");
  await writeFile(reportFile, `${report}\n`, "utf-8");

  stdout(
    JSON.stringify({
      command: "report",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFile: reportFile,
      overallReadiness: assessment.overallReadiness,
      overallRiskScore: assessment.overallRiskScore,
      overallComplexityScore: assessment.overallComplexityScore,
      overallConfidence: assessment.overallConfidence
    })
  );
};

const executeGenerateSql = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateSqlArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateDataverseSqlFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(
    parsedArgs.outputFolder,
    artifactPaths
  );
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    manualReviewItems,
    sqlPlan: generation.output.sqlPlan
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-sql",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      tablesGenerated: generation.output.tablesGenerated,
      columnsGenerated: generation.output.columnsGenerated,
      relationshipsGenerated: generation.output.relationshipsGenerated,
      warnings: planned.plan.summary.warnings,
      unsupportedFeatures: planned.plan.summary.unsupportedFeatures,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerateReact = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateReactArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateCanvasReactFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(
    parsedArgs.outputFolder,
    artifactPaths
  );
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    formulaHotspots: generation.output.formulaHotspots
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    formulaHotspots: generation.output.formulaHotspots,
    manualReviewItems
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-react",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      appsGenerated: generation.output.appsGenerated,
      screensGenerated: generation.output.screensGenerated,
      controlsGenerated: generation.output.controlsGenerated,
      formulasPreserved: generation.output.formulasPreserved,
      formulasClassified: generation.output.formulasClassified,
      stubsGenerated: generation.output.stubsGenerated,
      unsupportedFormulas: generation.output.unsupportedFormulas,
      manualConversionHotspots: generation.output.manualConversionHotspots,
      unsupportedControls: generation.output.unsupportedControls,
      warnings: planned.plan.summary.warnings,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerate = async (args: string[], stdout: WriteFn): Promise<void> => {
  const [subcommand, ...subcommandArgs] = args;

  if (subcommand === "sql") {
    await executeGenerateSql(subcommandArgs, stdout);
    return;
  }

  if (subcommand === "react") {
    await executeGenerateReact(subcommandArgs, stdout);
    return;
  }

  throw new CliError(
    "INVALID_COMMAND",
    "Supported generate commands are: sql, react."
  );
};

const formatError = (error: unknown): string => {
  if (error instanceof CliError) {
    return JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details ?? {}
    });
  }

  return JSON.stringify({
    code: "UNEXPECTED_ERROR",
    message: "Unexpected CLI failure.",
    details: {}
  });
};

export const runCli = async (
  args: string[],
  stdout: WriteFn = console.log,
  stderr: WriteFn = console.error
): Promise<number> => {
  try {
    const [command, ...commandArgs] = args;

    if (command === "analyse") {
      await executeAnalyse(commandArgs, stdout);
      return 0;
    }

    if (command === "report") {
      await executeReport(commandArgs, stdout);
      return 0;
    }

    if (command === "generate") {
      await executeGenerate(commandArgs, stdout);
      return 0;
    }

    if (!command) {
      throw new CliError(
        "INVALID_COMMAND",
        "No command provided."
      );
    }

    throw new CliError(
      "INVALID_COMMAND",
      "Supported commands are: analyse, report, generate."
    );
  } catch (error) {
    stderr(formatError(error));
    return 1;
  }
};

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
