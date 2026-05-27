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

import { parseCanvasApps } from "./canvas";
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
  canvasAppsParsed: number;
  canvasScreensParsed: number;
  canvasControlsParsed: number;
  canvasFormulasParsed: number;
  canvasScreensByReadiness: {
    high: number;
    medium: number;
    low: number;
    blocked: number;
  };
  canvasControlsByRole: Record<string, number>;
  canvasBlockedControls: number;
  canvasUnknownControls: number;
  canvasComplexFormulas: number;
  canvasLayoutWarnings: number;
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

interface FlowInventoryArtifact {
  artifactId: string;
  name: string;
  kind: string;
  provenance: {
    sourcePath: string;
    sourceType: "flow";
  };
  confidence: number;
}

interface DependencyGraphBuildResult {
  edges: DependencyEdge[];
  warnings: ParserWarning[];
  unresolvedDependencies: number;
}

const discoverFlowArtifacts = (
  files: Array<{
    path: string;
    classification: string;
  }>
): FlowInventoryArtifact[] => {
  const flowArtifacts = new Map<string, FlowInventoryArtifact>();

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
  }

  return sorted(Array.from(flowArtifacts.values()), (artifact) => artifact.artifactId);
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
  const canvasAppIds = new Set(ir.canvasApps.map((canvasApp) => canvasApp.artifactId));

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
    const allScreenControls = canvasApp.screens.flatMap((screen) => screen.controls);
    const dataSourceByName = new Map(
      canvasApp.dataSources.map((dataSource) => [dataSource.name, dataSource.artifactId])
    );
    const variableByName = new Map(
      canvasApp.variables.map((variable) => [variable.name, variable.artifactId])
    );
    const collectionByName = new Map(
      canvasApp.collections.map((collection) => [collection.name, collection.artifactId])
    );
    const screenByName = new Map(
      canvasApp.screens.map((screen) => [screen.screenName, screen.artifactId])
    );
    const controlById = new Set(
      allScreenControls.map((control) => control.artifactId)
    );
    const controlByArtifactId = new Map(
      allScreenControls.map((control) => [control.artifactId, control])
    );

    registerEdge({
      sourceArtifactId: ir.solution.artifactId,
      targetArtifactId: canvasApp.artifactId,
      dependencyType: "solution-canvas-app",
      provenance: canvasApp.provenance,
      confidence: canvasApp.confidence,
      resolved: true
    });

    for (const screen of canvasApp.screens) {
      registerEdge({
        sourceArtifactId: canvasApp.artifactId,
        targetArtifactId: screen.artifactId,
        dependencyType: "canvas-app-screen",
        provenance: screen.provenance,
        confidence: screen.confidence,
        resolved: true
      });

      for (const control of screen.controls) {
        registerEdge({
          sourceArtifactId: screen.artifactId,
          targetArtifactId: control.artifactId,
          dependencyType: "screen-control",
          provenance: control.provenance,
          confidence: control.confidence,
          resolved: true
        });

        if (
          control.role === "pageContainer" ||
          control.role === "sectionContainer" ||
          control.normalizedLayout.inferredLayoutMode === "verticalStack" ||
          control.normalizedLayout.inferredLayoutMode === "horizontalStack" ||
          control.normalizedLayout.inferredLayoutMode === "grid"
        ) {
          registerEdge({
            sourceArtifactId: screen.artifactId,
            targetArtifactId: control.artifactId,
            dependencyType: "screen-layout-container",
            provenance: control.provenance,
            confidence: control.confidence,
            resolved: true
          });
        }

        if (control.parentControl) {
          if (controlById.has(control.parentControl)) {
            registerEdge({
              sourceArtifactId: control.parentControl,
              targetArtifactId: control.artifactId,
              dependencyType: "control-child-control",
              provenance: control.provenance,
              confidence: control.confidence,
              resolved: true
            });
          } else {
            registerUnresolved(
              control.artifactId,
              control.parentControl,
              "control-child-control",
              control.provenance.sourcePath,
              "canvas",
              "DEPENDENCY_UNRESOLVED_CANVAS_PARENT_CONTROL",
              `Control "${control.controlName}" references parent "${control.parentControl}" which is unresolved.`
            );
          }
        }

        for (const hint of control.dataBindingHints) {
          const dataSourceId = dataSourceByName.get(hint);

          if (dataSourceId) {
            registerEdge({
              sourceArtifactId: control.artifactId,
              targetArtifactId: dataSourceId,
              dependencyType: "control-data-source",
              provenance: control.provenance,
              confidence: 0.8,
              resolved: true
            });
          } else if (!hint.includes("ThisItem") && !hint.includes("Parent.")) {
            registerUnresolved(
              control.artifactId,
              buildArtifactId("canvas-datasource", `${canvasApp.appId}-${hint}`),
              "control-data-source",
              control.provenance.sourcePath,
              "canvas",
              "DEPENDENCY_UNRESOLVED_CANVAS_CONTROL_DATASOURCE",
              `Control "${control.controlName}" references data source "${hint}" which is unresolved.`
            );
          }
        }

        if (control.role === "gallery") {
          for (const childId of control.children) {
            registerEdge({
              sourceArtifactId: control.artifactId,
              targetArtifactId: childId,
              dependencyType: "gallery-template-control",
              provenance: control.provenance,
              confidence: control.confidence,
              resolved: true
            });
          }
        }

        if (control.role === "form") {
          for (const childId of control.children) {
            const child = controlByArtifactId.get(childId);

            if (child?.role === "dataCard") {
              registerEdge({
                sourceArtifactId: control.artifactId,
                targetArtifactId: child.artifactId,
                dependencyType: "form-data-card",
                provenance: child.provenance,
                confidence: child.confidence,
                resolved: true
              });
            }
          }
        }

        if (control.role === "dataCard" && control.boundField) {
          registerEdge({
            sourceArtifactId: control.artifactId,
            targetArtifactId: buildArtifactId(
              "field",
              `${canvasApp.appId}-${control.boundField}`
            ),
            dependencyType: "data-card-bound-field",
            provenance: control.provenance,
            confidence: control.confidence,
            resolved: true
          });
        }

        for (const formula of control.formulas) {
          registerEdge({
            sourceArtifactId: control.artifactId,
            targetArtifactId: formula.artifactId,
            dependencyType: "control-formula",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });
        }
      }
    }

    for (const formula of canvasApp.formulas) {
      for (const dataSourceName of formula.likelyDataSources) {
        const dataSourceId = dataSourceByName.get(dataSourceName);

        if (dataSourceId) {
          registerEdge({
            sourceArtifactId: formula.artifactId,
            targetArtifactId: dataSourceId,
            dependencyType: "formula-data-source",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });

          if (
            formula.formulaFeatures.includes("patch") ||
            formula.formulaFeatures.includes("submitForm")
          ) {
            registerEdge({
              sourceArtifactId: formula.artifactId,
              targetArtifactId: dataSourceId,
              dependencyType: "formula-target-table",
              provenance: formula.provenance,
              confidence: formula.confidence,
              resolved: true
            });
          }
        } else {
          registerUnresolved(
            formula.artifactId,
            buildArtifactId("canvas-datasource", `${canvasApp.appId}-${dataSourceName}`),
            "formula-data-source",
            formula.provenance.sourcePath,
            "canvas",
            "DEPENDENCY_UNRESOLVED_CANVAS_DATASOURCE",
            `Formula "${formula.artifactId}" references data source "${dataSourceName}" which is unresolved.`
          );
        }
      }

      for (const variableName of formula.likelyVariables) {
        const variableId = variableByName.get(variableName);

        if (variableId) {
          registerEdge({
            sourceArtifactId: formula.artifactId,
            targetArtifactId: variableId,
            dependencyType: "formula-variable",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });
        } else {
          registerUnresolved(
            formula.artifactId,
            buildArtifactId("canvas-variable", `${canvasApp.appId}-${variableName}`),
            "formula-variable",
            formula.provenance.sourcePath,
            "canvas",
            "DEPENDENCY_UNRESOLVED_CANVAS_VARIABLE",
            `Formula "${formula.artifactId}" references variable "${variableName}" which is unresolved.`
          );
        }
      }

      for (const collectionName of formula.likelyCollections) {
        const collectionId = collectionByName.get(collectionName);

        if (collectionId) {
          registerEdge({
            sourceArtifactId: formula.artifactId,
            targetArtifactId: collectionId,
            dependencyType: "formula-collection",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });
        } else {
          registerUnresolved(
            formula.artifactId,
            buildArtifactId("canvas-collection", `${canvasApp.appId}-${collectionName}`),
            "formula-collection",
            formula.provenance.sourcePath,
            "canvas",
            "DEPENDENCY_UNRESOLVED_CANVAS_COLLECTION",
            `Formula "${formula.artifactId}" references collection "${collectionName}" which is unresolved.`
          );
        }
      }

      if (formula.navigationTargetScreen) {
        const screenId = screenByName.get(formula.navigationTargetScreen);

        if (screenId) {
          registerEdge({
            sourceArtifactId: formula.artifactId,
            targetArtifactId: screenId,
            dependencyType: "navigate-target-screen",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });
        } else {
          registerUnresolved(
            formula.artifactId,
            buildArtifactId(
              "canvas-screen",
              `${canvasApp.appId}-${formula.navigationTargetScreen}`
            ),
            "navigate-target-screen",
            formula.provenance.sourcePath,
            "canvas",
            "DEPENDENCY_UNRESOLVED_CANVAS_NAVIGATION",
            `Formula "${formula.artifactId}" references navigation target "${formula.navigationTargetScreen}" which is unresolved.`
          );
        }
      }
    }
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
    if (file.classification !== "workflows-folder") {
      continue;
    }

    const absolutePath = path.join(solutionPath, file.path);
    let content = "";

    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const ownerArtifactId = buildArtifactId(
      "workflow",
      path.parse(file.path).name || file.path
    );

    if (!flowIds.has(ownerArtifactId)) {
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
            sourceType: "flow"
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
          "flow",
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
            sourceType: "flow"
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
          "flow",
          "DEPENDENCY_UNRESOLVED_ENVIRONMENT_VARIABLE",
          `Environment variable "${environmentVariable.schemaName}" was referenced in "${file.path}" but is unresolved.`
        );
      }
    }
  }

  for (const canvasApp of ir.canvasApps) {
    if (!canvasAppIds.has(canvasApp.artifactId)) {
      continue;
    }

    const formulaOwners = [
      ...canvasApp.formulas,
      ...canvasApp.screens.flatMap((screen) => screen.formulas),
      ...canvasApp.components.flatMap((component) => component.formulas)
    ];

    for (const formula of formulaOwners) {
      for (const environmentVariable of ir.environmentVariables) {
        if (formula.rawExpression.includes(environmentVariable.schemaName)) {
          registerEdge({
            sourceArtifactId: environmentVariable.artifactId,
            targetArtifactId: formula.artifactId,
            dependencyType: "environment-variable-dependent-artifact",
            provenance: formula.provenance,
            confidence: formula.confidence,
            resolved: true
          });
        }
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
  const canvasResult = await parseCanvasApps(solutionPath, discoveryResult.data);
  const infrastructureResult = await parseSolutionInfrastructure(
    solutionPath,
    discoveryResult.data
  );
  const flowArtifacts = discoverFlowArtifacts(discoveryResult.data.files);
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
    data: canvasResult.data,
    warnings: canvasResult.warnings,
    unsupported: canvasResult.unsupported,
    confidence: canvasResult.confidence,
    provenance: canvasResult.provenance
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
      (file) =>
        file.classification !== "unknown" &&
        file.classification !== "canvas-unknown"
    ).length,
    unknownFiles: discoveryResult.data.files.filter(
      (file) =>
        file.classification === "unknown" ||
        file.classification === "canvas-unknown"
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
    canvasApps: canvasResult.data.length,
    canvasScreens: canvasResult.data.reduce(
      (count, app) => count + app.screens.length,
      0
    ),
    canvasControls: canvasResult.data.reduce(
      (count, app) =>
        count +
        app.screens.reduce((screenCount, screen) => screenCount + screen.controls.length, 0),
      0
    ),
    canvasFormulas: canvasResult.data.reduce(
      (count, app) => count + app.formulas.length,
      0
    ),
    canvasScreensByReadiness: {
      high: canvasResult.data.reduce(
        (count, app) =>
          count +
          app.screens.filter((screen) => screen.migrationReadiness === "high").length,
        0
      ),
      medium: canvasResult.data.reduce(
        (count, app) =>
          count +
          app.screens.filter((screen) => screen.migrationReadiness === "medium").length,
        0
      ),
      low: canvasResult.data.reduce(
        (count, app) =>
          count +
          app.screens.filter((screen) => screen.migrationReadiness === "low").length,
        0
      ),
      blocked: canvasResult.data.reduce(
        (count, app) =>
          count +
          app.screens.filter((screen) => screen.migrationReadiness === "blocked").length,
        0
      )
    },
    canvasControlsByRole: canvasResult.data.reduce<Record<string, number>>((roles, app) => {
      for (const control of app.screens.flatMap((screen) => screen.controls)) {
        roles[control.role] = (roles[control.role] ?? 0) + 1;
      }

      return roles;
    }, {}),
    canvasBlockedControls: canvasResult.data.reduce(
      (count, app) =>
        count +
        app.screens.reduce(
          (screenCount, screen) =>
            screenCount +
            screen.controls.filter(
              (control) => control.migrationReadiness === "blocked"
            ).length,
          0
        ),
      0
    ),
    canvasUnknownControls: canvasResult.data.reduce(
      (count, app) =>
        count +
        app.screens.reduce(
          (screenCount, screen) =>
            screenCount + screen.controls.filter((control) => control.role === "unknown").length,
          0
        ),
      0
    ),
    canvasComplexFormulas: canvasResult.data.reduce(
      (count, app) =>
        count + app.formulas.filter((formula) => formula.complexity === "complex").length,
      0
    ),
    canvasLayoutWarnings: ir.warnings.filter((warning) =>
      warning.code.startsWith("CANVAS_LAYOUT_")
    ).length,
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
    canvasAppsParsed: ir.analysisSummary.canvasApps,
    canvasScreensParsed: ir.analysisSummary.canvasScreens,
    canvasControlsParsed: ir.analysisSummary.canvasControls,
    canvasFormulasParsed: ir.analysisSummary.canvasFormulas,
    canvasScreensByReadiness: ir.analysisSummary.canvasScreensByReadiness,
    canvasControlsByRole: ir.analysisSummary.canvasControlsByRole,
    canvasBlockedControls: ir.analysisSummary.canvasBlockedControls,
    canvasUnknownControls: ir.analysisSummary.canvasUnknownControls,
    canvasComplexFormulas: ir.analysisSummary.canvasComplexFormulas,
    canvasLayoutWarnings: ir.analysisSummary.canvasLayoutWarnings,
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
