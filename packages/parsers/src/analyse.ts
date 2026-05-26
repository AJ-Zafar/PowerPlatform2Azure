import {
  createEmptyPowerPlatformIR,
  mergeParseResultIntoIR,
  mergeSolutionMetadataIntoIR,
  validatePowerPlatformIR,
  type ParseResult,
  type PowerPlatformIR
} from "@power-exit/ir";

import { parseDataverseMetadata } from "./dataverse";
import { parseSolutionInfrastructure } from "./infrastructure";
import { parseSolutionManifest } from "./manifest";
import { discoverSolutionFiles } from "./solution-discovery";

export interface AnalyseSummary {
  filesScanned: number;
  solutionMetadataFound: boolean;
  entitiesParsed: number;
  attributesParsed: number;
  relationshipsParsed: number;
  environmentVariables: number;
  connectionReferences: number;
  securityRoles: number;
  warnings: number;
  unsupportedFeatures: number;
}

export interface AnalyseResult {
  ir: PowerPlatformIR;
  summary: AnalyseSummary;
}

const applyGlobalParseMetadata = <T>(
  ir: PowerPlatformIR,
  parseResult: ParseResult<T>
): PowerPlatformIR =>
  validatePowerPlatformIR({
    ...ir,
    warnings: [...ir.warnings, ...parseResult.warnings],
    unsupportedFeatures: [...ir.unsupportedFeatures, ...parseResult.unsupported],
    confidence: Math.min(ir.confidence, parseResult.confidence)
  });

export const analyseSolutionFolder = async (
  solutionPath: string
): Promise<AnalyseResult> => {
  const discoveryResult = await discoverSolutionFiles(solutionPath);
  const manifestResult = await parseSolutionManifest(solutionPath, discoveryResult.data);
  const dataverseResult = await parseDataverseMetadata(solutionPath, discoveryResult.data);
  const infrastructureResult = await parseSolutionInfrastructure(
    solutionPath,
    discoveryResult.data
  );
  let ir = createEmptyPowerPlatformIR({
    solutionFolder: solutionPath
  });

  ir = mergeSolutionMetadataIntoIR(ir, manifestResult.data);
  ir = mergeParseResultIntoIR(ir, "dataverse", dataverseResult);
  ir = mergeParseResultIntoIR(ir, "environmentVariables", {
    data: infrastructureResult.data.environmentVariables,
    warnings: infrastructureResult.warnings,
    unsupported: infrastructureResult.unsupported,
    confidence: infrastructureResult.confidence,
    provenance: infrastructureResult.provenance
  });
  ir = mergeParseResultIntoIR(ir, "connectionReferences", {
    data: infrastructureResult.data.connectionReferences,
    warnings: [],
    unsupported: [],
    confidence: 1,
    provenance: infrastructureResult.provenance
  });
  ir = mergeParseResultIntoIR(ir, "security", {
    data: infrastructureResult.data.security,
    warnings: [],
    unsupported: [],
    confidence: 1,
    provenance: infrastructureResult.provenance
  });
  ir = applyGlobalParseMetadata(ir, discoveryResult);
  ir = applyGlobalParseMetadata(ir, manifestResult);

  const summary: AnalyseSummary = {
    filesScanned: discoveryResult.data.filesScanned,
    solutionMetadataFound:
      manifestResult.data.uniqueName !== "unknown_solution" ||
      manifestResult.data.name !== "Unknown Solution",
    entitiesParsed: dataverseResult.data.entities.length,
    attributesParsed: dataverseResult.data.entities.reduce(
      (count, entity) => count + entity.attributes.length,
      0
    ),
    relationshipsParsed: dataverseResult.data.relationships.length,
    environmentVariables: infrastructureResult.data.environmentVariables.length,
    connectionReferences: infrastructureResult.data.connectionReferences.length,
    securityRoles: infrastructureResult.data.security.roles.length,
    warnings: ir.warnings.length,
    unsupportedFeatures: ir.unsupportedFeatures.length
  };

  return {
    ir: validatePowerPlatformIR(ir),
    summary
  };
};
