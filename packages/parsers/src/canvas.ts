import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

import {
  createUnsupportedFeature,
  createWarning,
  type CanvasApp,
  type CanvasComponent,
  type CanvasControl,
  type CanvasFormula,
  type CanvasNavigationReference,
  type CanvasResource,
  type CanvasScreen,
  type ParseResult,
  type ParserWarning,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import type { SolutionDiscoveryData } from "./solution-discovery";
import { buildArtifactId, clampConfidence, sorted } from "./utils";

const KNOWN_CONTROL_TYPES = new Set([
  "screen",
  "label",
  "button",
  "textbox",
  "gallery",
  "form",
  "datacard",
  "container",
  "icon",
  "rectangle",
  "timer",
  "image",
  "dropdown",
  "combobox",
  "toggle",
  "checkbox",
  "listbox",
  "htmltext"
]);

const FORMULA_LAYOUT_KEYS = new Set([
  "X",
  "Y",
  "Width",
  "Height",
  "Visible",
  "DisplayMode",
  "Fill",
  "Color",
  "Align",
  "LayoutDirection",
  "Wrap",
  "TemplateSize"
]);

interface CanvasAppAccumulator {
  appId: string;
  appName: string;
  appRoot: string;
  appProperties: Record<string, unknown>;
  screens: CanvasScreen[];
  components: CanvasComponent[];
  resources: CanvasResource[];
  dataSources: CanvasApp["dataSources"];
  variables: CanvasApp["variables"];
  collections: CanvasApp["collections"];
  navigationReferences: CanvasNavigationReference[];
  formulas: CanvasFormula[];
  unsupportedFeatures: UnsupportedFeature[];
  warnings: ParserWarning[];
  provenance: SourceProvenance;
}

const asObjectRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const inferCanvasAppRoot = (
  relativePath: string
): {
  appRoot: string;
  appName: string;
} => {
  const segments = relativePath.split("/");
  const canvasAppsIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "canvasapps"
  );

  if (canvasAppsIndex >= 0 && segments[canvasAppsIndex + 1]) {
    return {
      appRoot: segments.slice(0, canvasAppsIndex + 2).join("/"),
      appName: segments[canvasAppsIndex + 1]
    };
  }

  const msappUnpackedIndex = segments.findIndex((segment) =>
    segment.toLowerCase().includes(".msapp-unpacked")
  );

  if (msappUnpackedIndex >= 0) {
    return {
      appRoot: segments.slice(0, msappUnpackedIndex + 1).join("/"),
      appName: segments[msappUnpackedIndex].replace(".msapp-unpacked", "")
    };
  }

  const srcIndex = segments.findIndex((segment) => segment.toLowerCase() === "src");

  if (srcIndex > 0) {
    return {
      appRoot: segments.slice(0, srcIndex).join("/"),
      appName: segments[srcIndex - 1]
    };
  }

  return {
    appRoot: segments[0] ?? "unknown-canvas-app",
    appName: segments[0] ?? "unknown-canvas-app"
  };
};

const parseYamlDocument = (
  content: string,
  sourcePath: string,
  warnings: ParserWarning[],
  provenance: SourceProvenance
): Record<string, unknown> | undefined => {
  try {
    const document = parseDocument(content, {
      prettyErrors: false
    });

    if (document.errors.length > 0) {
      warnings.push(
        createWarning({
          code: "CANVAS_SOURCE_MALFORMED",
          message: "Canvas source file could not be parsed as YAML.",
          sourceLocation: sourcePath,
          provenance,
          severity: "error",
          confidence: 1
        })
      );
      return undefined;
    }

    const parsed = document.toJSON();

    return asObjectRecord(parsed);
  } catch {
    warnings.push(
      createWarning({
        code: "CANVAS_SOURCE_MALFORMED",
        message: "Canvas source file could not be parsed as YAML.",
        sourceLocation: sourcePath,
        provenance,
        severity: "error",
        confidence: 1
      })
    );
    return undefined;
  }
};

const extractFunctionNames = (expression: string): string[] => {
  const matches = expression.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
  const names = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      names.add(match[1]);
    }
  }

  return sorted(Array.from(names), (name) => name);
};

const extractFromRegex = (expression: string, regex: RegExp): string[] => {
  const values = new Set<string>();
  const matches = expression.matchAll(regex);

  for (const match of matches) {
    if (match[1]) {
      values.add(match[1]);
    }
  }

  return sorted(Array.from(values), (value) => value);
};

const createFormula = (
  appId: string,
  ownerArtifactId: string,
  ownerType: CanvasFormula["ownerType"],
  propertyName: string | undefined,
  rawExpression: string,
  sourcePath: string,
  dataSourceNames: Set<string>
): CanvasFormula => {
  const functionNames = extractFunctionNames(rawExpression);
  const likelyDataSources = sorted(
    Array.from(dataSourceNames).filter((name) =>
      new RegExp(`\\b${name}\\b`).test(rawExpression)
    ),
    (name) => name
  );
  const setVariables = extractFromRegex(
    rawExpression,
    /\bSet\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g
  );
  const contextVariables = extractFromRegex(
    rawExpression,
    /\bUpdateContext\s*\(\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)/g
  );
  const likelyVariables = sorted([...setVariables, ...contextVariables], (name) => name);
  const likelyCollections = sorted(
    extractFromRegex(
      rawExpression,
      /\b(?:Collect|ClearCollect)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g
    ),
    (name) => name
  );
  const navigateTargets = extractFromRegex(
    rawExpression,
    /\bNavigate\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g
  );
  const formulaFeatures = sorted(
    [
      functionNames.includes("Navigate") ? "navigate" : undefined,
      functionNames.includes("Patch") ? "patch" : undefined,
      functionNames.includes("SubmitForm") ? "submitForm" : undefined,
      functionNames.includes("Collect") ? "collect" : undefined,
      functionNames.includes("ClearCollect") ? "clearCollect" : undefined,
      functionNames.includes("Set") ? "set" : undefined,
      functionNames.includes("UpdateContext") ? "updateContext" : undefined
    ].filter((value): value is CanvasFormula["formulaFeatures"][number] =>
      Boolean(value)
    ),
    (feature) => feature
  );

  return {
    artifactId: buildArtifactId(
      "canvas-formula",
      `${appId}-${ownerArtifactId}-${propertyName ?? "formula"}-${rawExpression.slice(
        0,
        24
      )}`
    ),
    ownerArtifactId,
    ownerType,
    propertyName,
    rawExpression,
    functionNames,
    likelyDataSources,
    likelyVariables,
    likelyCollections,
    navigationTargetScreen: navigateTargets[0],
    formulaFeatures: formulaFeatures.length > 0 ? formulaFeatures : ["unknown"],
    provenance: {
      sourcePath,
      sourceType: "canvas"
    },
    confidence: 0.8
  };
};

const parseControl = (
  appId: string,
  sourcePath: string,
  rawControl: unknown,
  dataSourceNames: Set<string>,
  warnings: ParserWarning[],
  unsupported: UnsupportedFeature[],
  controlAccumulator: CanvasControl[],
  parentControl?: string
): CanvasControl | undefined => {
  const controlObject = asObjectRecord(rawControl);
  const controlName =
    (typeof controlObject.Name === "string" ? controlObject.Name : undefined) ??
    (typeof controlObject.controlName === "string"
      ? controlObject.controlName
      : undefined);
  const controlType =
    (typeof controlObject.Type === "string" ? controlObject.Type : undefined) ??
    (typeof controlObject.ControlType === "string"
      ? controlObject.ControlType
      : undefined) ??
    "unknown";

  if (!controlName) {
    warnings.push(
      createWarning({
        code: "CANVAS_CONTROL_MISSING_NAME",
        message: "Canvas control is missing a control name and was skipped.",
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.95
      })
    );
    return undefined;
  }

  const controlArtifactId = buildArtifactId("canvas-control", `${appId}-${controlName}`);
  const properties = asObjectRecord(controlObject.Properties);
  const childControlsRaw = asArray(controlObject.Children ?? controlObject.Controls);
  const children: CanvasControl[] = [];
  const formulas: CanvasFormula[] = [];
  const formulasByProperty: CanvasControl["formulasByProperty"] = [];
  const dataBindingHints = new Set<string>();
  const layoutProperties: CanvasControl["layoutProperties"] = {};

  if (!KNOWN_CONTROL_TYPES.has(controlType.toLowerCase())) {
    warnings.push(
      createWarning({
        code: "CANVAS_UNKNOWN_CONTROL_TYPE",
        message: `Unknown control type "${controlType}" was preserved as unsupported.`,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.9
      })
    );
    unsupported.push(
      createUnsupportedFeature({
        featureType: `canvas.control-type.${controlType.toLowerCase()}`,
        sourceLocation: sourcePath,
        reason: "Control type is not currently mapped by the parser.",
        suggestedRemediation:
          "Preserve control metadata and add support in a later parser iteration.",
        severity: "medium",
        confidence: 0.9,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        }
      })
    );
  }

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    if (FORMULA_LAYOUT_KEYS.has(propertyName)) {
      layoutProperties[propertyName as keyof typeof layoutProperties] =
        typeof propertyValue === "string" || typeof propertyValue === "number" || typeof propertyValue === "boolean"
          ? (propertyValue as never)
          : undefined;
    }

    if (typeof propertyValue !== "string") {
      continue;
    }

    if (
      propertyName === "Items" ||
      propertyName === "DataSource" ||
      propertyName === "Default"
    ) {
      dataBindingHints.add(propertyValue);
    }

    if (
      propertyValue.trim().startsWith("=") ||
      /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(propertyValue)
    ) {
      const formula = createFormula(
        appId,
        controlArtifactId,
        "control",
        propertyName,
        propertyValue,
        sourcePath,
        dataSourceNames
      );

      formulas.push(formula);
      formulasByProperty.push({
        propertyName,
        formulaArtifactId: formula.artifactId
      });
    }
  }

  for (const rawChildControl of childControlsRaw) {
    const childControl = parseControl(
      appId,
      sourcePath,
      rawChildControl,
      dataSourceNames,
      warnings,
      unsupported,
      controlAccumulator,
      controlArtifactId
    );

    if (childControl) {
      children.push(childControl);
    }
  }

  const control: CanvasControl = {
    artifactId: controlArtifactId,
    controlName,
    controlType,
    parentControl,
    children: sorted(children.map((child) => child.artifactId), (id) => id),
    properties,
    formulasByProperty: sorted(
      formulasByProperty,
      (formulaRef) => `${formulaRef.propertyName}:${formulaRef.formulaArtifactId}`
    ),
    formulas: sorted(formulas, (formula) => formula.artifactId),
    layoutProperties,
    dataBindingHints: sorted(Array.from(dataBindingHints), (hint) => hint),
    provenance: {
      sourcePath,
      sourceType: "canvas"
    },
    confidence: clampConfidence(1 - formulas.length * 0.01)
  };

  controlAccumulator.push(control);
  return control;
};

const parseScreenFile = (
  appId: string,
  sourcePath: string,
  document: Record<string, unknown>,
  dataSourceNames: Set<string>,
  warnings: ParserWarning[],
  unsupported: UnsupportedFeature[],
  screenIndex: number
): CanvasScreen => {
  const screenRoot = asObjectRecord(document.Screen ?? document);
  const screenName =
    (typeof screenRoot.Name === "string" ? screenRoot.Name : undefined) ??
    path.parse(sourcePath).name;
  const controlsRaw = asArray(screenRoot.Controls);
  const controls: CanvasControl[] = [];

  for (const rawControl of controlsRaw) {
    parseControl(
      appId,
      sourcePath,
      rawControl,
      dataSourceNames,
      warnings,
      unsupported,
      controls
    );
  }

  const formulas = sorted(
    controls.flatMap((control) => control.formulas),
    (formula) => formula.artifactId
  );

  return {
    artifactId: buildArtifactId("canvas-screen", `${appId}-${screenName}`),
    screenName,
    sourceFile: sourcePath,
    controls: sorted(controls, (control) => control.controlName),
    formulas,
    layoutMetadata: asObjectRecord(screenRoot.Layout),
    order: screenIndex,
    provenance: {
      sourcePath,
      sourceType: "canvas"
    },
    confidence: clampConfidence(1 - warnings.length * 0.01)
  };
};

const parseComponentFile = (
  appId: string,
  sourcePath: string,
  document: Record<string, unknown>,
  dataSourceNames: Set<string>,
  warnings: ParserWarning[],
  unsupported: UnsupportedFeature[]
): CanvasComponent => {
  const componentRoot = asObjectRecord(document.Component ?? document);
  const componentName =
    (typeof componentRoot.Name === "string" ? componentRoot.Name : undefined) ??
    path.parse(sourcePath).name;
  const controlsRaw = asArray(componentRoot.Controls);
  const controls: CanvasControl[] = [];

  for (const rawControl of controlsRaw) {
    parseControl(
      appId,
      sourcePath,
      rawControl,
      dataSourceNames,
      warnings,
      unsupported,
      controls
    );
  }
  const formulas = sorted(
    controls.flatMap((control) => control.formulas),
    (formula) => formula.artifactId
  );

  return {
    artifactId: buildArtifactId("canvas-component", `${appId}-${componentName}`),
    componentName,
    sourceFile: sourcePath,
    controls: sorted(controls, (control) => control.controlName),
    formulas,
    provenance: {
      sourcePath,
      sourceType: "canvas"
    },
    confidence: clampConfidence(1 - warnings.length * 0.01)
  };
};

const parseCanvasAppProperties = (
  sourcePath: string,
  document: Record<string, unknown>,
  appAccumulator: CanvasAppAccumulator
): void => {
  appAccumulator.appProperties = document;
  const dataSources = asArray(document.DataSources);

  for (const dataSource of dataSources) {
    const sourceRecord = asObjectRecord(dataSource);
    const name =
      (typeof sourceRecord.Name === "string" ? sourceRecord.Name : undefined) ??
      (typeof dataSource === "string" ? dataSource : undefined);

    if (!name) {
      continue;
    }

    appAccumulator.dataSources.push({
      artifactId: buildArtifactId("canvas-datasource", `${appAccumulator.appId}-${name}`),
      name,
      sourceType:
        (typeof sourceRecord.Type === "string" ? sourceRecord.Type : undefined) ??
        "unknown",
      provenance: {
        sourcePath,
        sourceType: "canvas"
      },
      confidence: 0.8
    });
  }

  const formulas = asObjectRecord(document.Formulas);

  for (const [propertyName, value] of Object.entries(formulas)) {
    if (typeof value !== "string") {
      continue;
    }

    appAccumulator.formulas.push(
      createFormula(
        appAccumulator.appId,
        buildArtifactId("canvas-app", appAccumulator.appId),
        "app",
        propertyName,
        value,
        sourcePath,
        new Set(appAccumulator.dataSources.map((dataSource) => dataSource.name))
      )
    );
  }
};

const parseFormulaDocument = (
  app: CanvasAppAccumulator,
  sourcePath: string,
  document: Record<string, unknown>
): CanvasFormula[] => {
  const formulaRoot = asObjectRecord(document.Formula ?? document);
  const expression =
    (typeof formulaRoot.Expression === "string" ? formulaRoot.Expression : undefined) ??
    (typeof formulaRoot.Value === "string" ? formulaRoot.Value : undefined);

  if (!expression) {
    return [];
  }

  const ownerArtifactId = buildArtifactId(
    "canvas-app",
    `${app.appId}-${path.parse(sourcePath).name}`
  );

  return [
    createFormula(
      app.appId,
      ownerArtifactId,
      "app",
      typeof formulaRoot.Name === "string" ? formulaRoot.Name : path.parse(sourcePath).name,
      expression,
      sourcePath,
      new Set(app.dataSources.map((dataSource) => dataSource.name))
    )
  ];
};

const gatherCanvasNavigationReferences = (
  app: CanvasApp
): CanvasNavigationReference[] => {
  const screenNameMap = new Map(
    app.screens.map((screen) => [screen.screenName, screen.artifactId])
  );

  return sorted(
    app.formulas
      .filter((formula) => Boolean(formula.navigationTargetScreen))
      .map((formula) => {
        const targetScreenName = formula.navigationTargetScreen ?? "unknown";
        const targetScreenArtifactId = screenNameMap.get(targetScreenName);

        return {
          artifactId: buildArtifactId(
            "canvas-navigation",
            `${formula.artifactId}-${targetScreenName}`
          ),
          sourceFormulaArtifactId: formula.artifactId,
          targetScreenName,
          targetScreenArtifactId,
          resolved: Boolean(targetScreenArtifactId),
          provenance: formula.provenance,
          confidence: formula.confidence
        } satisfies CanvasNavigationReference;
      }),
    (reference) => reference.artifactId
  );
};

export const parseCanvasApps = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<CanvasApp[]>> => {
  const canvasFiles = discovery.files.filter((file) =>
    file.classification.startsWith("canvas-")
  );
  const appMap = new Map<string, CanvasAppAccumulator>();
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];

  for (const canvasFile of canvasFiles) {
    const { appRoot, appName } = inferCanvasAppRoot(canvasFile.path);
    const appId = buildArtifactId("canvas-app", appName);

    if (!appMap.has(appRoot)) {
      appMap.set(appRoot, {
        appId,
        appName,
        appRoot,
        appProperties: {},
        screens: [],
        components: [],
        resources: [],
        dataSources: [],
        variables: [],
        collections: [],
        navigationReferences: [],
        formulas: [],
        unsupportedFeatures: [],
        warnings: [],
        provenance: {
          sourcePath: canvasFile.path,
          sourceType: "canvas"
        }
      });
    }

    const app = appMap.get(appRoot);

    if (!app) {
      continue;
    }

    const absolutePath = path.join(solutionPath, canvasFile.path);
    let content = "";

    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      const warning = createWarning({
        code: "CANVAS_SOURCE_READ_FAILURE",
        message: "Canvas source file could not be read.",
        sourceLocation: canvasFile.path,
        provenance: {
          sourcePath: canvasFile.path,
          sourceType: "canvas"
        },
        confidence: 1
      });
      warnings.push(warning);
      app.warnings.push(warning);
      continue;
    }

    if (canvasFile.classification === "canvas-resource") {
      app.resources.push({
        artifactId: buildArtifactId("canvas-resource", `${appId}-${canvasFile.path}`),
        resourceType: "resource",
        resourceName: path.basename(canvasFile.path),
        resourcePath: canvasFile.path,
        provenance: {
          sourcePath: canvasFile.path,
          sourceType: "canvas"
        },
        confidence: 0.8
      });
      continue;
    }

    const parsed = parseYamlDocument(
      content,
      canvasFile.path,
      warnings,
      app.provenance
    );

    if (!parsed) {
      continue;
    }

    const dataSourceNames = new Set(app.dataSources.map((dataSource) => dataSource.name));

    switch (canvasFile.classification) {
      case "canvas-app": {
        parseCanvasAppProperties(canvasFile.path, parsed, app);
        break;
      }
      case "canvas-screen":
      case "canvas-control": {
        app.screens.push(
          parseScreenFile(
            appId,
            canvasFile.path,
            parsed,
            dataSourceNames,
            warnings,
            unsupported,
            app.screens.length
          )
        );
        break;
      }
      case "canvas-formula": {
        app.formulas.push(...parseFormulaDocument(app, canvasFile.path, parsed));
        break;
      }
      case "canvas-component": {
        app.components.push(
          parseComponentFile(
            appId,
            canvasFile.path,
            parsed,
            dataSourceNames,
            warnings,
            unsupported
          )
        );
        break;
      }
      case "canvas-unknown": {
        const warning = createWarning({
          code: "CANVAS_UNKNOWN_SOURCE_SHAPE",
          message: "Canvas source file shape is unknown and preserved with warning.",
          sourceLocation: canvasFile.path,
          provenance: {
            sourcePath: canvasFile.path,
            sourceType: "canvas"
          },
          confidence: 0.9
        });

        warnings.push(warning);
        app.warnings.push(warning);
        break;
      }
      default:
        break;
    }
  }

  const parsedApps = sorted(
    Array.from(appMap.values()).map((app) => {
      const allFormulas = sorted(
        [
          ...app.formulas,
          ...app.screens.flatMap((screen) => screen.formulas),
          ...app.components.flatMap((component) => component.formulas)
        ],
        (formula) => formula.artifactId
      );
      const variableNames = new Set(allFormulas.flatMap((formula) => formula.likelyVariables));
      const collectionNames = new Set(
        allFormulas.flatMap((formula) => formula.likelyCollections)
      );
      const appWarnings = [...app.warnings];
      const appUnsupported = [...app.unsupportedFeatures];
      const navigationReferences = gatherCanvasNavigationReferences({
        artifactId: app.appId,
        appId: app.appId,
        appName: app.appName,
        appProperties: app.appProperties,
        screens: app.screens,
        components: app.components,
        resources: app.resources,
        dataSources: app.dataSources,
        variables: [],
        collections: [],
        navigationReferences: [],
        formulas: allFormulas,
        unsupportedFeatures: [],
        warnings: [],
        provenance: app.provenance,
        confidence: 1
      });

      for (const navigationReference of navigationReferences) {
        if (!navigationReference.resolved) {
          const warning = createWarning({
            code: "CANVAS_NAVIGATION_UNRESOLVED_TARGET",
            message: `Navigate target "${navigationReference.targetScreenName}" could not be resolved.`,
            sourceLocation: navigationReference.provenance.sourcePath,
            provenance: navigationReference.provenance,
            confidence: 0.9
          });
          appWarnings.push(warning);
        }
      }

      return {
        artifactId: app.appId,
        appId: app.appId,
        appName: app.appName,
        appProperties: app.appProperties,
        screens: sorted(app.screens, (screen) => screen.screenName),
        components: sorted(app.components, (component) => component.componentName),
        resources: sorted(app.resources, (resource) => resource.resourcePath),
        dataSources: sorted(app.dataSources, (dataSource) => dataSource.name),
        variables: sorted(
          Array.from(variableNames).map((variableName) => ({
            artifactId: buildArtifactId("canvas-variable", `${app.appId}-${variableName}`),
            name: variableName,
            provenance: app.provenance,
            confidence: 0.8
          })),
          (variable) => variable.name
        ),
        collections: sorted(
          Array.from(collectionNames).map((collectionName) => ({
            artifactId: buildArtifactId(
              "canvas-collection",
              `${app.appId}-${collectionName}`
            ),
            name: collectionName,
            provenance: app.provenance,
            confidence: 0.8
          })),
          (collection) => collection.name
        ),
        navigationReferences,
        formulas: allFormulas,
        unsupportedFeatures: sorted(appUnsupported, (feature) => feature.featureType),
        warnings: sorted(appWarnings, (warning) => `${warning.code}:${warning.sourceLocation}`),
        provenance: app.provenance,
        confidence: clampConfidence(1 - appWarnings.length * 0.02)
      } satisfies CanvasApp;
    }),
    (app) => app.appName
  );

  for (const app of parsedApps) {
    warnings.push(...app.warnings);
    unsupported.push(...app.unsupportedFeatures);
  }

  const confidence =
    parsedApps.length === 0
      ? 1
      : clampConfidence(
          1 - warnings.length / (parsedApps.length * 15 + 1)
        );

  return {
    data: parsedApps,
    warnings: sorted(warnings, (warning) => `${warning.code}:${warning.sourceLocation}`),
    unsupported: sorted(unsupported, (feature) => feature.featureType),
    confidence,
    provenance: {
      sourcePath: solutionPath,
      sourceType: "canvas"
    }
  };
};
