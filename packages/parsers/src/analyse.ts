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
import { parseCloudFlows } from "./flow";
import { parseSolutionInfrastructure } from "./infrastructure";
import { parseSolutionManifest } from "./manifest";
import { discoverSolutionFiles } from "./solution-discovery";
import { buildArtifactId, sorted } from "./utils";

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
  flowsParsed: number;
  triggersParsed: number;
  actionsParsed: number;
  connectorsDetected: number;
  premiumCustomConnectors: number;
  flowsByReadiness: {
    high: number;
    medium: number;
    low: number;
    blocked: number;
  };
  unsupportedFlowFeatures: number;
  unresolvedFlowDependencies: number;
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

interface DependencyGraphBuildResult {
  edges: DependencyEdge[];
  warnings: ParserWarning[];
  unresolvedDependencies: number;
  unresolvedFlowDependencies: number;
}

const buildDependencyGraph = async (ir: PowerPlatformIR): Promise<DependencyGraphBuildResult> => {
  const edges: DependencyEdge[] = [];
  const warnings: ParserWarning[] = [];
  let unresolvedDependencies = 0;
  let unresolvedFlowDependencies = 0;
  const entityIds = new Set(ir.dataverse.entities.map((entity) => entity.artifactId));
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
    const actionArtifactByName = new Map(flow.actions.map((action) => [action.actionName, action]));
    const variableArtifactByName = new Map(
      flow.variables.map((variable) => [variable.variableName, variable.artifactId])
    );
    const firstActions = flow.actions.filter((action) => action.runAfter.length === 0);

    registerEdge({
      sourceArtifactId: ir.solution.artifactId,
      targetArtifactId: flow.artifactId,
      dependencyType: "solution-workflow",
      provenance: flow.provenance,
      confidence: flow.confidence,
      resolved: true
    });

    registerEdge({
      sourceArtifactId: flow.artifactId,
      targetArtifactId: flow.trigger.artifactId,
      dependencyType: "flow-trigger",
      provenance: flow.trigger.provenance,
      confidence: flow.trigger.confidence,
      resolved: true
    });

    for (const action of flow.actions) {
      registerEdge({
        sourceArtifactId: flow.artifactId,
        targetArtifactId: action.artifactId,
        dependencyType: "flow-action",
        provenance: action.provenance,
        confidence: action.confidence,
        resolved: true
      });
    }

    for (const firstAction of firstActions) {
      registerEdge({
        sourceArtifactId: flow.trigger.artifactId,
        targetArtifactId: firstAction.artifactId,
        dependencyType: "trigger-first-action",
        provenance: firstAction.provenance,
        confidence: firstAction.confidence,
        resolved: true
      });
    }

    for (const action of flow.actions) {
      for (const runAfterDependency of action.runAfter) {
        const sourceAction = actionArtifactByName.get(runAfterDependency.actionName);
        if (sourceAction) {
          registerEdge({
            sourceArtifactId: sourceAction.artifactId,
            targetArtifactId: action.artifactId,
            dependencyType: "action-runafter-action",
            provenance: action.provenance,
            confidence: action.confidence,
            resolved: true
          });
          continue;
        }

        unresolvedFlowDependencies += 1;
        registerUnresolved(
          action.artifactId,
          buildArtifactId("flow-action", `${flow.flowId}-${runAfterDependency.actionName}`),
          "action-runafter-action",
          action.provenance.sourcePath,
          "flow",
          "DEPENDENCY_UNRESOLVED_FLOW_RUNAFTER_ACTION",
          `Flow action "${action.actionName}" depends on unresolved action "${runAfterDependency.actionName}".`
        );
      }

      for (const childAction of action.childActions) {
        registerEdge({
          sourceArtifactId: action.artifactId,
          targetArtifactId: childAction.artifactId,
          dependencyType: "scope-child-action",
          provenance: childAction.provenance,
          confidence: childAction.confidence,
          resolved: true
        });
      }

      if (action.connectorApi) {
        registerEdge({
          sourceArtifactId: action.artifactId,
          targetArtifactId: buildArtifactId("flow-connector", action.connectorApi),
          dependencyType: "action-connector",
          provenance: action.provenance,
          confidence: action.confidence,
          resolved: true
        });
      }

      for (const connectionReference of action.referencedConnectionReferences) {
        const connectionArtifactId = buildArtifactId(
          "connection-reference",
          connectionReference
        );
        if (connectionIds.has(connectionArtifactId)) {
          registerEdge({
            sourceArtifactId: action.artifactId,
            targetArtifactId: connectionArtifactId,
            dependencyType: "action-connection-reference",
            provenance: action.provenance,
            confidence: action.confidence,
            resolved: true
          });
        } else {
          unresolvedFlowDependencies += 1;
          registerUnresolved(
            action.artifactId,
            connectionArtifactId,
            "action-connection-reference",
            action.provenance.sourcePath,
            "flow",
            "DEPENDENCY_UNRESOLVED_FLOW_CONNECTION_REFERENCE",
            `Flow action "${action.actionName}" references unresolved connection reference "${connectionReference}".`
          );
        }
      }

      for (const entityName of action.referencedEntities) {
        const targetEntityId = buildArtifactId("entity", entityName);
        if (entityIds.has(targetEntityId)) {
          registerEdge({
            sourceArtifactId: action.artifactId,
            targetArtifactId: targetEntityId,
            dependencyType: "action-dataverse-entity",
            provenance: action.provenance,
            confidence: action.confidence,
            resolved: true
          });
        } else {
          unresolvedFlowDependencies += 1;
          registerUnresolved(
            action.artifactId,
            targetEntityId,
            "action-dataverse-entity",
            action.provenance.sourcePath,
            "flow",
            "DEPENDENCY_UNRESOLVED_FLOW_DATAVERSE_ENTITY",
            `Flow action "${action.actionName}" references unresolved Dataverse entity "${entityName}".`
          );
        }
      }

      for (const expression of action.expressions) {
        for (const reference of expression.references) {
          let targetArtifactId: string | undefined;
          if (reference.referenceType === "variable") {
            targetArtifactId =
              variableArtifactByName.get(reference.name) ??
              buildArtifactId("flow-variable", `${flow.flowId}-${reference.name}`);
          } else if (reference.referenceType === "environmentVariable") {
            targetArtifactId = buildArtifactId("env-var", reference.name);
          } else if (reference.referenceType === "entity") {
            targetArtifactId = buildArtifactId("entity", reference.name);
          } else if (reference.referenceType === "action") {
            targetArtifactId =
              actionArtifactByName.get(reference.name)?.artifactId ??
              buildArtifactId("flow-action", `${flow.flowId}-${reference.name}`);
          } else if (reference.referenceType === "trigger") {
            targetArtifactId = flow.trigger.artifactId;
          }

          if (!targetArtifactId) {
            continue;
          }

          const isResolved =
            reference.referenceType === "trigger" ||
            (reference.referenceType === "variable" &&
              variableArtifactByName.has(reference.name)) ||
            (reference.referenceType === "entity" && entityIds.has(targetArtifactId)) ||
            (reference.referenceType === "environmentVariable" &&
              envVarIds.has(targetArtifactId)) ||
            (reference.referenceType === "action" &&
              actionArtifactByName.has(reference.name));

          if (isResolved) {
            registerEdge({
              sourceArtifactId: expression.artifactId,
              targetArtifactId,
              dependencyType: "expression-reference-artifact",
              provenance: expression.provenance,
              confidence: expression.confidence,
              resolved: true
            });
          } else {
            unresolvedFlowDependencies += 1;
            registerUnresolved(
              expression.artifactId,
              targetArtifactId,
              "expression-reference-artifact",
              expression.provenance.sourcePath,
              "flow",
              "DEPENDENCY_UNRESOLVED_FLOW_EXPRESSION_REFERENCE",
              `Flow expression "${expression.expressionName}" references unresolved ${reference.referenceType} "${reference.name}".`
            );
          }
        }
      }
    }
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
    unresolvedDependencies,
    unresolvedFlowDependencies
  };
};

export const analyseSolutionFolder = async (
  solutionPath: string
): Promise<AnalyseResult> => {
  const discoveryResult = await discoverSolutionFiles(solutionPath);
  const manifestResult = await parseSolutionManifest(solutionPath, discoveryResult.data);
  const dataverseResult = await parseDataverseMetadata(solutionPath, discoveryResult.data);
  const canvasResult = await parseCanvasApps(solutionPath, discoveryResult.data);
  const flowResult = await parseCloudFlows(solutionPath, discoveryResult.data);
  const infrastructureResult = await parseSolutionInfrastructure(
    solutionPath,
    discoveryResult.data
  );
  let ir = createEmptyPowerPlatformIR({
    solutionFolder: solutionPath
  });

  ir = mergeSolutionMetadataIntoIR(ir, manifestResult.data);
  ir = mergeParseResultIntoIR(ir, "cloudFlows", flowResult);
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
  const dependencyGraph = await buildDependencyGraph(ir);

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
    flows: flowResult.data.length,
    flowTriggers: flowResult.data.filter((flow) => flow.trigger.triggerType !== "Unknown").length,
    flowActions: flowResult.data.reduce(
      (count, flow) =>
        count +
        flow.actions.reduce(
          (actionCount, action) => actionCount + 1 + action.childActions.length,
          0
        ),
      0
    ),
    flowConnectorsDetected: new Set(
      flowResult.data
        .flatMap((flow) => [
          ...flow.connections.map((connection) => connection.connectorApi),
          ...flow.actions
            .map((action) => action.connectorApi)
            .filter((connector): connector is string => Boolean(connector)),
          flow.trigger.connectorApi
        ])
        .filter((connector): connector is string => Boolean(connector))
    ).size,
    flowPremiumCustomConnectors: new Set(
      flowResult.data
        .flatMap((flow) => [
        ...flow.connections
          .filter((connection) =>
            ["premium", "custom"].includes(connection.connectorCategory)
          )
          .map((connection) => connection.connectorApi),
        ...flow.actions
          .filter((action) => ["premium", "custom"].includes(action.connectorCategory))
          .map((action) => action.connectorApi ?? "")
        ])
        .filter((connector) => connector.length > 0)
    ).size,
    flowsByReadiness: {
      high: flowResult.data.filter((flow) => flow.migrationReadiness === "high").length,
      medium: flowResult.data.filter((flow) => flow.migrationReadiness === "medium").length,
      low: flowResult.data.filter((flow) => flow.migrationReadiness === "low").length,
      blocked: flowResult.data.filter((flow) => flow.migrationReadiness === "blocked").length
    },
    unsupportedFlowFeatures: flowResult.data.reduce(
      (count, flow) => count + flow.unsupportedFeatures.length,
      0
    ),
    unresolvedFlowDependencies: dependencyGraph.unresolvedFlowDependencies,
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
    flowsParsed: ir.analysisSummary.flows,
    triggersParsed: ir.analysisSummary.flowTriggers,
    actionsParsed: ir.analysisSummary.flowActions,
    connectorsDetected: ir.analysisSummary.flowConnectorsDetected,
    premiumCustomConnectors: ir.analysisSummary.flowPremiumCustomConnectors,
    flowsByReadiness: ir.analysisSummary.flowsByReadiness,
    unsupportedFlowFeatures: ir.analysisSummary.unsupportedFlowFeatures,
    unresolvedFlowDependencies: ir.analysisSummary.unresolvedFlowDependencies,
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
