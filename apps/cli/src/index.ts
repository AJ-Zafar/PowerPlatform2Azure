#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeDeterministicIR, validatePowerPlatformIR } from "@power-exit/ir";
import {
  assessPowerPlatformIR,
  generateAssessmentReportMarkdown
} from "@power-exit/assessment";
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

    if (!command) {
      throw new CliError(
        "INVALID_COMMAND",
        "No command provided."
      );
    }

    throw new CliError(
      "INVALID_COMMAND",
      "Supported commands are: analyse, report."
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
