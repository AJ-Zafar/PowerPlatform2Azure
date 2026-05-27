import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createWarning,
  createEmptyPowerPlatformIR,
  mergeAnalysisSummaryIntoIR,
  mergeDependencyEdgesIntoIR,
  mergeParseResultIntoIR,
  mergeSolutionMetadataIntoIR,
  validatePowerPlatformIR,
  type AnalysisSummary,
  type DependencyEdge,
  type ParseResult,
  type ParserWarning,
  type PowerPlatformIR
} from "@power-exit/ir";

import { parseDataverseMetadata } from "./dataverse";
import { parseSolutionInfrastructure } from "./infrastructure";
import { parseSolutionManifest } from "./manifest";
import { discoverSolutionFiles } from "./solution-discovery";
import { buildArtifactId, clampConfidence, sorted } from "./utils";

export interface AnalyseSummary {
  filesScanned: number;
  classifiedFiles: number;
  unknownFiles: number;
  solutionMetadataFound: boolean;
  entitiesParsed: number;
  attributesParsed: number;
  relationshipsParsed: number;
  choicesParsed: number;
  environmentVariables: number;
  connectionReferences: number;
  securityRoles: number;
  warnings: number;
  unsupportedFeatures: number;
  unresolvedDependencies: number;
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

interface InventoryArtifact {
  artifactId: string;
  name: string;
  kind: string;
  provenance: {
    sourcePath: string;
    sourceType: "canvas" | "flow";
  };
  confidence: number;
}

interface DependencyGraphBuildResult {
  edges: DependencyEdge[];
  warnings: ParserWarning[];
  unresolvedDependencies: number;
}

const discoverInventoryArtifacts = (
  solutionPath: string,
  files: Array<{
    path: string;
    classification: string;
  }>
): {
  flowArtifacts: InventoryArtifact[];
  canvasArtifacts: InventoryArtifact[];
} => {
  const flowArtifacts = new Map<string, InventoryArtifact>();
  const canvasArtifacts = new Map<string, InventoryArtifact>();

  for (const file of files) {
    const parsedPath = path.parse(file.path);
    const baseName = parsedPath.name || path.basename(file.path);

    if (file.classification === "workflows-folder") {
      const artifactId = buildArtifactId("workflow", baseName);
      flowArtifacts.set(artifactId, {
        artifactId,
        name: baseName,
        kind: "workflow",
        provenance: {
          sourcePath: file.path,
          sourceType: "flow"
        },
        confidence: 0.7
      });
    }

    if (file.classification === "canvas-source") {
      const artifactId = buildArtifactId("canvas-app", baseName);
      canvasArtifacts.set(artifactId, {
        artifactId,
        name: baseName,
        kind: "canvas-app",
        provenance: {
          sourcePath: file.path,
          sourceType: "canvas"
        },
        confidence: 0.7
      });
    }
  }

  return {
    flowArtifacts: sorted(Array.from(flowArtifacts.values()), (artifact) => artifact.artifactId),
    canvasArtifacts: sorted(
      Array.from(canvasArtifacts.values()),
      (artifact) => artifact.artifactId
    )
  };
};

const buildDependencyGraph = async (
  ir: PowerPlatformIR,
  solutionPath: string,
  discoveryFiles: Array<{
    path: string;
    classification: string;
  }>
): Promise<DependencyGraphBuildResult> => {
  const edges: DependencyEdge[] = [];
  const warnings: ParserWarning[] = [];
  let unresolvedDependencies = 0;
  const entityIds = new Set(ir.dataverse.entities.map((entity) => entity.artifactId));
  const flowIds = new Set(ir.cloudFlows.map((flow) => flow.artifactId));
  const canvasIds = new Set(ir.canvasApps.map((canvas) => canvas.artifactId));
  const connectionIds = new Set(
    ir.connectionReferences.map((connection) => connection.artifactId)
  );
  const envVarIds = new Set(
    ir.environmentVariables.map((environmentVariable) => environmentVariable.artifactId)
  );
  const dependencyKey = (edge: DependencyEdge): string =>
    `${edge.sourceArtifactId}:${edge.targetArtifactId}:${edge.dependencyType}`;
  const seen = new Set<string>();
  const registerEdge = (edge: DependencyEdge): void => {
    const key = dependencyKey(edge);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    edges.push(edge);
  };
  const registerUnresolved = (
    sourceArtifactId: string,
    targetArtifactId: string,
    dependencyType: DependencyEdge["dependencyType"],
    sourcePath: string,
    sourceType: "solution" | "dataverse" | "security" | "flow" | "canvas",
    warningCode: string,
    warningMessage: string
  ): void => {
    unresolvedDependencies += 1;
    registerEdge({
      sourceArtifactId,
      targetArtifactId,
      dependencyType,
      provenance: {
        sourcePath,
        sourceType
      },
      confidence: 0.7,
      resolved: false,
      unresolvedWarning: warningMessage
    });
    warnings.push(
      createWarning({
        code: warningCode,
        message: warningMessage,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType
        },
        confidence: 0.95
      })
    );
  };

  for (const entity of ir.dataverse.entities) {
    registerEdge({
      sourceArtifactId: ir.solution.artifactId,
      targetArtifactId: entity.artifactId,
      dependencyType: "solution-entity",
      provenance: entity.provenance,
      confidence: 0.95,
      resolved: true
    });

    for (const attribute of entity.attributes) {
      registerEdge({
        sourceArtifactId: entity.artifactId,
        targetArtifactId: attribute.artifactId,
        dependencyType: "entity-attribute",
        provenance: attribute.provenance,
        confidence: 0.95,
        resolved: true
      });
    }
  }

  for (const relationship of ir.dataverse.relationships) {
    const sourceEntityId = buildArtifactId(
      "entity",
      relationship.fromEntityLogicalName
    );
    const targetEntityId = buildArtifactId("entity", relationship.toEntityLogicalName);

    if (entityIds.has(sourceEntityId)) {
      registerEdge({
        sourceArtifactId: sourceEntityId,
        targetArtifactId: relationship.artifactId,
        dependencyType: "entity-relationship",
        provenance: relationship.provenance,
        confidence: relationship.confidence,
        resolved: true
      });
    } else {
      registerUnresolved(
        relationship.artifactId,
        sourceEntityId,
        "entity-relationship",
        relationship.provenance.sourcePath,
        "dataverse",
        "DEPENDENCY_UNRESOLVED_RELATIONSHIP_SOURCE",
        `Relationship "${relationship.schemaName}" source entity "${relationship.fromEntityLogicalName}" is unresolved.`
      );
    }

    if (entityIds.has(targetEntityId)) {
      registerEdge({
        sourceArtifactId: relationship.artifactId,
        targetArtifactId: targetEntityId,
        dependencyType: "relationship-target-entity",
        provenance: relationship.provenance,
        confidence: relationship.confidence,
        resolved: true
      });
    } else {
      registerUnresolved(
        relationship.artifactId,
        targetEntityId,
        "relationship-target-entity",
        relationship.provenance.sourcePath,
        "dataverse",
        "DEPENDENCY_UNRESOLVED_RELATIONSHIP_TARGET",
        `Relationship "${relationship.schemaName}" target entity "${relationship.toEntityLogicalName}" is unresolved.`
      );
    }
  }

  for (const flow of ir.cloudFlows) {
    registerEdge({
      sourceArtifactId: ir.solution.artifactId,
      targetArtifactId: flow.artifactId,
      dependencyType: "solution-workflow",
      provenance: flow.provenance,
      confidence: flow.confidence,
      resolved: true
    });
  }

  for (const canvasApp of ir.canvasApps) {
    registerEdge({
      sourceArtifactId: ir.solution.artifactId,
      targetArtifactId: canvasApp.artifactId,
      dependencyType: "solution-canvas-app",
      provenance: canvasApp.provenance,
      confidence: canvasApp.confidence,
      resolved: true
    });
  }

  for (const role of ir.security.roles) {
    for (const privilege of role.privileges) {
      const targetEntityId = privilege.entityLogicalName
        ? buildArtifactId("entity", privilege.entityLogicalName)
        : buildArtifactId("entity", "unknown");

      if (!privilege.entityLogicalName || !entityIds.has(targetEntityId)) {
        registerUnresolved(
          role.artifactId,
          targetEntityId,
          "security-role-entity-privilege",
          privilege.provenance.sourcePath,
          "security",
          "DEPENDENCY_UNRESOLVED_SECURITY_PRIVILEGE",
          `Security privilege "${privilege.privilegeName}" on role "${role.roleName}" does not resolve to a known entity.`
        );
        continue;
      }

      registerEdge({
        sourceArtifactId: role.artifactId,
        targetArtifactId: targetEntityId,
        dependencyType: "security-role-entity-privilege",
        provenance: privilege.provenance,
        confidence: privilege.confidence,
        resolved: true
      });
    }
  }

  for (const file of discoveryFiles) {
    if (
      file.classification !== "workflows-folder" &&
      file.classification !== "canvas-source"
    ) {
      continue;
    }

    const absolutePath = path.join(solutionPath, file.path);
    let content = "";

    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const ownerArtifactId = file.classification === "workflows-folder"
      ? buildArtifactId("workflow", path.parse(file.path).name || file.path)
      : buildArtifactId("canvas-app", path.parse(file.path).name || file.path);

    if (file.classification === "workflows-folder" && !flowIds.has(ownerArtifactId)) {
      continue;
    }

    if (file.classification === "canvas-source" && !canvasIds.has(ownerArtifactId)) {
      continue;
    }

    for (const connectionReference of ir.connectionReferences) {
      if (!content.includes(connectionReference.logicalName)) {
        continue;
      }

      if (connectionIds.has(connectionReference.artifactId)) {
        registerEdge({
          sourceArtifactId: ownerArtifactId,
          targetArtifactId: connectionReference.artifactId,
          dependencyType: "flow-connection-reference",
          provenance: {
            sourcePath: file.path,
            sourceType: file.classification === "workflows-folder" ? "flow" : "canvas"
          },
          confidence: 0.85,
          resolved: true
        });
      } else {
        registerUnresolved(
          ownerArtifactId,
          connectionReference.artifactId,
          "flow-connection-reference",
          file.path,
          file.classification === "workflows-folder" ? "flow" : "canvas",
          "DEPENDENCY_UNRESOLVED_CONNECTION_REFERENCE",
          `Connection reference "${connectionReference.logicalName}" was detected in "${file.path}" but could not be resolved.`
        );
      }
    }

    for (const environmentVariable of ir.environmentVariables) {
      if (!content.includes(environmentVariable.schemaName)) {
        continue;
      }

      if (envVarIds.has(environmentVariable.artifactId)) {
        registerEdge({
          sourceArtifactId: environmentVariable.artifactId,
          targetArtifactId: ownerArtifactId,
          dependencyType: "environment-variable-dependent-artifact",
          provenance: {
            sourcePath: file.path,
            sourceType: file.classification === "workflows-folder" ? "flow" : "canvas"
          },
          confidence: 0.8,
          resolved: true
        });
      } else {
        registerUnresolved(
          environmentVariable.artifactId,
          ownerArtifactId,
          "environment-variable-dependent-artifact",
          file.path,
          file.classification === "workflows-folder" ? "flow" : "canvas",
          "DEPENDENCY_UNRESOLVED_ENVIRONMENT_VARIABLE",
          `Environment variable "${environmentVariable.schemaName}" was referenced in "${file.path}" but is unresolved.`
        );
      }
    }
  }

  return {
    edges: sorted(edges, (edge) =>
      `${edge.sourceArtifactId}:${edge.targetArtifactId}:${edge.dependencyType}`
    ),
    warnings,
    unresolvedDependencies
  };
};

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
  const { flowArtifacts, canvasArtifacts } = discoverInventoryArtifacts(
    solutionPath,
    discoveryResult.data.files
  );
  let ir = createEmptyPowerPlatformIR({
    solutionFolder: solutionPath
  });

  ir = mergeSolutionMetadataIntoIR(ir, manifestResult.data);
  ir = mergeParseResultIntoIR(ir, "cloudFlows", {
    data: flowArtifacts,
    warnings: [],
    unsupported: [],
    confidence: clampConfidence(
      1 - flowArtifacts.length * 0.01
    ),
    provenance: {
      sourcePath: solutionPath,
      sourceType: "flow"
    }
  });
  ir = mergeParseResultIntoIR(ir, "canvasApps", {
    data: canvasArtifacts,
    warnings: [],
    unsupported: [],
    confidence: clampConfidence(
      1 - canvasArtifacts.length * 0.01
    ),
    provenance: {
      sourcePath: solutionPath,
      sourceType: "canvas"
    }
  });
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
  const dependencyGraph = await buildDependencyGraph(
    ir,
    solutionPath,
    discoveryResult.data.files
  );

  ir = mergeDependencyEdgesIntoIR(ir, dependencyGraph.edges);
  ir = applyGlobalParseMetadata(ir, {
    data: dependencyGraph.edges,
    warnings: dependencyGraph.warnings,
    unsupported: [],
    confidence: 1,
    provenance: {
      sourcePath: solutionPath,
      sourceType: "solution"
    }
  });

  const analysisSummary: AnalysisSummary = {
    filesScanned: discoveryResult.data.filesScanned,
    classifiedFiles: discoveryResult.data.files.filter(
      (file) => file.classification !== "unknown"
    ).length,
    unknownFiles: discoveryResult.data.files.filter(
      (file) => file.classification === "unknown"
    ).length,
    solutionMetadataPresence:
      manifestResult.data.uniqueName !== "unknown_solution" ||
      manifestResult.data.name !== "Unknown Solution",
    entities: dataverseResult.data.entities.length,
    attributes: dataverseResult.data.entities.reduce(
      (count, entity) => count + entity.attributes.length,
      0
    ),
    relationships: dataverseResult.data.relationships.length,
    choices: dataverseResult.data.optionSets.length,
    environmentVariables: infrastructureResult.data.environmentVariables.length,
    connectionReferences: infrastructureResult.data.connectionReferences.length,
    securityRoles: infrastructureResult.data.security.roles.length,
    warnings: ir.warnings.length,
    unsupportedFeatures: ir.unsupportedFeatures.length,
    unresolvedDependencies: dependencyGraph.unresolvedDependencies
  };

  ir = mergeAnalysisSummaryIntoIR(ir, analysisSummary);

  const summary: AnalyseSummary = {
    filesScanned: ir.analysisSummary.filesScanned,
    classifiedFiles: ir.analysisSummary.classifiedFiles,
    unknownFiles: ir.analysisSummary.unknownFiles,
    solutionMetadataFound: ir.analysisSummary.solutionMetadataPresence,
    entitiesParsed: ir.analysisSummary.entities,
    attributesParsed: ir.analysisSummary.attributes,
    relationshipsParsed: ir.analysisSummary.relationships,
    choicesParsed: ir.analysisSummary.choices,
    environmentVariables: ir.analysisSummary.environmentVariables,
    connectionReferences: ir.analysisSummary.connectionReferences,
    securityRoles: ir.analysisSummary.securityRoles,
    warnings: ir.analysisSummary.warnings,
    unsupportedFeatures: ir.analysisSummary.unsupportedFeatures,
    unresolvedDependencies: ir.analysisSummary.unresolvedDependencies
  };

  return {
    ir: validatePowerPlatformIR(ir),
    summary
  };
};
