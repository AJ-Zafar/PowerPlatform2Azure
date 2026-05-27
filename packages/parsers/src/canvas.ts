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

type CanvasLayoutMode = CanvasControl["normalizedLayout"]["inferredLayoutMode"];
type CanvasResponsiveHint = CanvasControl["normalizedLayout"]["responsiveHint"];
type CanvasControlRole = CanvasControl["role"];
type CanvasMigrationReadiness = CanvasControl["migrationReadiness"];

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

const isNumericLike = (value: unknown): value is number | string =>
  typeof value === "number" || typeof value === "string";

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
};

const inferLayoutMode = (
  controlType: string,
  layoutProperties: CanvasControl["layoutProperties"],
  rawProperties: Record<string, unknown>
): CanvasLayoutMode => {
  const normalizedType = controlType.toLowerCase();
  const layoutDirection =
    typeof layoutProperties.LayoutDirection === "string"
      ? layoutProperties.LayoutDirection.toLowerCase()
      : undefined;

  if (normalizedType === "gallery") {
    return "galleryTemplate";
  }

  if (normalizedType === "form" || normalizedType === "datacard") {
    return "formLayout";
  }

  if (layoutDirection === "vertical") {
    return "verticalStack";
  }

  if (layoutDirection === "horizontal") {
    return "horizontalStack";
  }

  if (
    "Columns" in rawProperties ||
    "ColumnCount" in rawProperties ||
    "RowCount" in rawProperties
  ) {
    return "grid";
  }

  if (isNumericLike(layoutProperties.X) || isNumericLike(layoutProperties.Y)) {
    return "absolute";
  }

  return "unknown";
};

const inferResponsiveHint = (
  layoutProperties: CanvasControl["layoutProperties"],
  rawProperties: Record<string, unknown>
): CanvasResponsiveHint => {
  if (layoutProperties.Wrap === true || String(layoutProperties.Wrap).toLowerCase() === "true") {
    return "wrap";
  }

  const widthValue = layoutProperties.Width;
  const heightValue = layoutProperties.Height;
  const widthText = typeof widthValue === "string" ? widthValue : "";
  const heightText = typeof heightValue === "string" ? heightValue : "";

  if (
    widthText.includes("Parent.") ||
    heightText.includes("Parent.") ||
    "FillPortion" in rawProperties
  ) {
    return "fillParent";
  }

  if (widthText.includes("App.") || heightText.includes("App.")) {
    return "stretch";
  }

  if (typeof widthValue === "number" || typeof heightValue === "number") {
    return "fixed";
  }

  return "unknown";
};

const classifyControlRole = (
  controlType: string,
  controlName: string,
  parentControl?: string
): { role: CanvasControlRole; roleConfidence: number } => {
  const normalizedType = controlType.toLowerCase();
  const normalizedName = controlName.toLowerCase();

  if (normalizedType === "screen" || (normalizedType === "container" && !parentControl)) {
    return { role: "pageContainer", roleConfidence: 0.92 };
  }

  if (normalizedType === "container") {
    return { role: "sectionContainer", roleConfidence: 0.88 };
  }

  if (normalizedType === "label") {
    if (
      normalizedName.includes("title") ||
      normalizedName.includes("header") ||
      normalizedName.includes("heading")
    ) {
      return { role: "heading", roleConfidence: 0.8 };
    }

    return { role: "text", roleConfidence: 0.85 };
  }

  if (normalizedType === "button") {
    return { role: "button", roleConfidence: 0.95 };
  }

  if (normalizedType === "textbox" || normalizedType === "textinput") {
    return { role: "input", roleConfidence: 0.9 };
  }

  if (
    normalizedType === "dropdown" ||
    normalizedType === "combobox" ||
    normalizedType === "listbox" ||
    normalizedType === "toggle" ||
    normalizedType === "checkbox"
  ) {
    return { role: "select", roleConfidence: 0.85 };
  }

  if (normalizedType === "datepicker") {
    return { role: "dateInput", roleConfidence: 0.85 };
  }

  if (normalizedType === "gallery") {
    return { role: "gallery", roleConfidence: 0.95 };
  }

  if (normalizedType === "form") {
    return { role: "form", roleConfidence: 0.95 };
  }

  if (normalizedType === "datacard") {
    return { role: "dataCard", roleConfidence: 0.92 };
  }

  if (normalizedType === "image") {
    return { role: "image", roleConfidence: 0.9 };
  }

  if (normalizedType === "icon") {
    return { role: "icon", roleConfidence: 0.9 };
  }

  if (normalizedType === "htmltext") {
    return { role: "html", roleConfidence: 0.95 };
  }

  if (
    normalizedType.includes("custom") ||
    normalizedType.includes("component") ||
    normalizedName.startsWith("cmp")
  ) {
    return { role: "customComponent", roleConfidence: 0.65 };
  }

  if (normalizedType === "rectangle") {
    return { role: "card", roleConfidence: 0.7 };
  }

  return { role: "unknown", roleConfidence: 0.4 };
};

const classifyReadiness = (
  layoutComplexity: number,
  formulaComplexity: number,
  dataBindingComplexity: number,
  unsupportedFeatureCount: number,
  forceBlocked = false
): CanvasMigrationReadiness => {
  if (forceBlocked || unsupportedFeatureCount >= 2) {
    return "blocked";
  }

  if (
    layoutComplexity >= 0.7 ||
    formulaComplexity >= 0.7 ||
    dataBindingComplexity >= 0.7
  ) {
    return "low";
  }

  if (
    layoutComplexity >= 0.35 ||
    formulaComplexity >= 0.35 ||
    dataBindingComplexity >= 0.35
  ) {
    return "medium";
  }

  return "high";
};

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
  const complexityScore = clampConfidence(
    Math.min(
      1,
      functionNames.length * 0.12 +
        (rawExpression.length > 80 ? 0.2 : 0) +
        (formulaFeatures.length > 2 ? 0.2 : 0)
    )
  );
  const complexity =
    complexityScore >= 0.7
      ? "complex"
      : complexityScore >= 0.35
        ? "moderate"
        : "simple";

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
    complexityScore,
    complexity,
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
  parentControl?: string,
  depth = 1,
  orderIndex = 0
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
  let localUnsupportedFeatureCount = 0;
  let unresolvedBindingCount = 0;

  if (!KNOWN_CONTROL_TYPES.has(controlType.toLowerCase())) {
    localUnsupportedFeatureCount += 1;
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
      propertyName === "Default" ||
      propertyName === "DataField"
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

      if (formula.complexity === "complex") {
        warnings.push(
          createWarning({
            code: "CANVAS_COMPLEX_FORMULA",
            message: `Control "${controlName}" has a complex formula on property "${propertyName}".`,
            sourceLocation: sourcePath,
            provenance: {
              sourcePath,
              sourceType: "canvas"
            },
            confidence: 0.85
          })
        );
      }
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
      controlArtifactId,
      depth + 1,
      children.length
    );

    if (childControl) {
      children.push(childControl);
    }
  }

  const { role, roleConfidence } = classifyControlRole(
    controlType,
    controlName,
    parentControl
  );
  const inferredLayoutMode = inferLayoutMode(controlType, layoutProperties, properties);
  const responsiveHint = inferResponsiveHint(layoutProperties, properties);
  const visible = normalizeBoolean(layoutProperties.Visible);
  const displayMode =
    typeof layoutProperties.DisplayMode === "string"
      ? layoutProperties.DisplayMode
      : undefined;
  const zIndexRaw = properties.ZIndex;
  const zIndex =
    typeof zIndexRaw === "number"
      ? zIndexRaw
      : typeof zIndexRaw === "string" && zIndexRaw.trim() !== ""
        ? Number(zIndexRaw)
        : undefined;

  if (depth >= 4) {
    warnings.push(
      createWarning({
        code: "CANVAS_DEEPLY_NESTED_CONTROLS",
        message: `Control "${controlName}" is deeply nested (${depth} levels).`,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.8
      })
    );
  }

  if (role === "html") {
    warnings.push(
      createWarning({
        code: "CANVAS_HTML_TEXT_USAGE",
        message: `Control "${controlName}" uses HtmlText and may require manual migration.`,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.9
      })
    );
  }

  if (role === "customComponent") {
    localUnsupportedFeatureCount += 1;
    warnings.push(
      createWarning({
        code: "CANVAS_CUSTOM_COMPONENT_USAGE",
        message: `Control "${controlName}" appears to be a custom component.`,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.9
      })
    );
  }

  if (role === "unknown") {
    localUnsupportedFeatureCount += 1;
  }

  for (const hint of dataBindingHints) {
    if (
      !dataSourceNames.has(hint) &&
      !hint.includes("ThisItem") &&
      !hint.includes("Parent.")
    ) {
      unresolvedBindingCount += 1;
      warnings.push(
        createWarning({
          code: "CANVAS_UNRESOLVED_DATA_BINDING",
          message: `Control "${controlName}" has unresolved data binding hint "${hint}".`,
          sourceLocation: sourcePath,
          provenance: {
            sourcePath,
            sourceType: "canvas"
          },
          confidence: 0.85
        })
      );
    }
  }

  const layoutComplexityBase: Record<CanvasLayoutMode, number> = {
    absolute: 0.7,
    verticalStack: 0.3,
    horizontalStack: 0.3,
    grid: 0.6,
    galleryTemplate: 0.55,
    formLayout: 0.5,
    unknown: 0.8
  };
  const layoutComplexity = clampConfidence(
    layoutComplexityBase[inferredLayoutMode] +
      Math.min(0.25, (depth - 1) * 0.08) +
      Math.min(0.2, childControlsRaw.length * 0.03)
  );
  const formulaComplexity = formulas.length
    ? clampConfidence(
        formulas.reduce((sum, formula) => sum + formula.complexityScore, 0) /
          formulas.length
      )
    : 0;
  const dataBindingComplexity = clampConfidence(
    Math.min(1, dataBindingHints.size * 0.2 + unresolvedBindingCount * 0.3)
  );
  const migrationReadiness = classifyReadiness(
    layoutComplexity,
    formulaComplexity,
    dataBindingComplexity,
    localUnsupportedFeatureCount,
    role === "unknown" || role === "customComponent"
  );
  const boundField =
    typeof properties.DataField === "string" ? properties.DataField : undefined;

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
    normalizedLayout: {
      absoluteX: layoutProperties.X,
      absoluteY: layoutProperties.Y,
      width: layoutProperties.Width,
      height: layoutProperties.Height,
      parentRelativePosition: {
        x: layoutProperties.X,
        y: layoutProperties.Y
      },
      inferredLayoutMode,
      responsiveHint,
      visible,
      displayMode,
      zIndex: Number.isFinite(zIndex) ? zIndex : undefined,
      orderIndex,
      rawLayoutProperties: layoutProperties
    },
    dataBindingHints: sorted(Array.from(dataBindingHints), (hint) => hint),
    role,
    roleConfidence,
    boundField,
    layoutComplexity,
    formulaComplexity,
    dataBindingComplexity,
    unsupportedFeatureCount: localUnsupportedFeatureCount,
    migrationReadiness,
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

  for (const [controlIndex, rawControl] of controlsRaw.entries()) {
    parseControl(
      appId,
      sourcePath,
      rawControl,
      dataSourceNames,
      warnings,
      unsupported,
      controls,
      undefined,
      1,
      controlIndex
    );
  }

  const formulas = sorted(
    controls.flatMap((control) => control.formulas),
    (formula) => formula.artifactId
  );
  const layoutComplexity = controls.length
    ? clampConfidence(
        controls.reduce((sum, control) => sum + control.layoutComplexity, 0) /
          controls.length
      )
    : 0;
  const formulaComplexity = formulas.length
    ? clampConfidence(
        formulas.reduce((sum, formula) => sum + formula.complexityScore, 0) /
          formulas.length
      )
    : 0;
  const dataBindingComplexity = controls.length
    ? clampConfidence(
        controls.reduce((sum, control) => sum + control.dataBindingComplexity, 0) /
          controls.length
      )
    : 0;
  const unsupportedFeatureCount = controls.reduce(
    (sum, control) => sum + control.unsupportedFeatureCount,
    0
  );
  const absoluteCount = controls.filter(
    (control) => control.normalizedLayout.inferredLayoutMode === "absolute"
  ).length;
  const absoluteRatio = controls.length > 0 ? absoluteCount / controls.length : 0;

  if (absoluteRatio >= 0.6) {
    warnings.push(
      createWarning({
        code: "CANVAS_LAYOUT_ABSOLUTE_HEAVY",
        message: `Screen "${screenName}" relies heavily on absolute positioning.`,
        sourceLocation: sourcePath,
        provenance: {
          sourcePath,
          sourceType: "canvas"
        },
        confidence: 0.8
      })
    );
  }

  const migrationReadiness = classifyReadiness(
    layoutComplexity,
    formulaComplexity,
    dataBindingComplexity,
    unsupportedFeatureCount
  );

  return {
    artifactId: buildArtifactId("canvas-screen", `${appId}-${screenName}`),
    screenName,
    sourceFile: sourcePath,
    controls: sorted(controls, (control) => control.controlName),
    formulas,
    layoutMetadata: asObjectRecord(screenRoot.Layout),
    order: screenIndex,
    layoutComplexity,
    formulaComplexity,
    dataBindingComplexity,
    unsupportedFeatureCount,
    migrationReadiness,
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
        layoutComplexity: 0,
        formulaComplexity: 0,
        dataBindingComplexity: 0,
        unsupportedFeatureCount: 0,
        migrationReadiness: "high",
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

      const screenLayoutComplexity = app.screens.length
        ? app.screens.reduce((sum, screen) => sum + screen.layoutComplexity, 0) /
          app.screens.length
        : 0;
      const appFormulaComplexity = allFormulas.length
        ? allFormulas.reduce((sum, formula) => sum + formula.complexityScore, 0) /
          allFormulas.length
        : 0;
      const controlCount = app.screens.reduce(
        (sum, screen) => sum + screen.controls.length,
        0
      );
      const appDataBindingComplexity = controlCount
        ? app.screens.reduce(
            (sum, screen) =>
              sum +
              screen.controls.reduce(
                (controlSum, control) => controlSum + control.dataBindingComplexity,
                0
              ),
            0
          ) / controlCount
        : 0;
      const appUnsupportedFeatureCount =
        appUnsupported.length +
        app.screens.reduce((sum, screen) => sum + screen.unsupportedFeatureCount, 0);
      const appMigrationReadiness = classifyReadiness(
        clampConfidence(screenLayoutComplexity),
        clampConfidence(appFormulaComplexity),
        clampConfidence(appDataBindingComplexity),
        appUnsupportedFeatureCount
      );

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
        layoutComplexity: clampConfidence(screenLayoutComplexity),
        formulaComplexity: clampConfidence(appFormulaComplexity),
        dataBindingComplexity: clampConfidence(appDataBindingComplexity),
        unsupportedFeatureCount: appUnsupportedFeatureCount,
        migrationReadiness: appMigrationReadiness,
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
