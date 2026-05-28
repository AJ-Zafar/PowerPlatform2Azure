import { z } from "zod";

import {
  sortByStableKey,
  validatePowerPlatformIR,
  type CanvasControl,
  type CanvasFormula,
  type CanvasScreen,
  type PowerPlatformIR
} from "@power-exit/ir";

import {
  createGenerationResultSchema,
  generationFormulaHotspotSchema,
  type GenerationResult,
  type GenerationFormulaHotspot,
  type GenerationUnsupportedFeature,
  type GenerationWarning,
  type GeneratedArtifact,
  type GeneratorContext
} from "./contracts";

const reactGenerationOutputSchema = z
  .object({
    appsGenerated: z.number().int().nonnegative(),
    screensGenerated: z.number().int().nonnegative(),
    controlsGenerated: z.number().int().nonnegative(),
    formulasPreserved: z.number().int().nonnegative(),
    formulasClassified: z.number().int().nonnegative(),
    stubsGenerated: z.number().int().nonnegative(),
    unsupportedFormulas: z.number().int().nonnegative(),
    manualConversionHotspots: z.number().int().nonnegative(),
    formulaHotspots: z.array(generationFormulaHotspotSchema),
    unsupportedControls: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative()
  })
  .strict();

export type CanvasReactGenerationOutput = z.infer<typeof reactGenerationOutputSchema>;

type CanvasAppsSection = PowerPlatformIR["canvasApps"];

const defaultContext = (): GeneratorContext => ({
  invocationProvenance: {
    sourcePath: "generators/react",
    sourceType: "generator"
  }
});

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug.length > 0 ? slug : "item";
};

const toPascalCase = (value: string): string => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return "Generated";
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
};

const toScreenFileSlug = (screenName: string): string => {
  const slug = slugify(screenName);
  return slug.endsWith("-screen") ? slug : `${slug}-screen`;
};

const toRouteSlug = (screenName: string): string => slugify(screenName);

const safeComment = (value: string): string => value.replace(/\*\//g, "* /");

const createWarning = (
  input: Omit<GenerationWarning, "severity" | "confidence">
): GenerationWarning => ({
  severity: "warning",
  confidence: 0.85,
  ...input
});

const createUnsupportedFeature = (
  input: Omit<GenerationUnsupportedFeature, "confidence">
): GenerationUnsupportedFeature => ({
  confidence: 0.9,
  ...input
});

const sortScreens = (screens: readonly CanvasScreen[]): CanvasScreen[] =>
  sortByStableKey(
    screens,
    (screen) =>
      `${String(screen.order ?? Number.MAX_SAFE_INTEGER).padStart(8, "0")}:${screen.screenName.toLowerCase()}`
  );

const sortControls = (controls: readonly CanvasControl[]): CanvasControl[] =>
  sortByStableKey(
    controls,
    (control) =>
      `${String(control.normalizedLayout.orderIndex ?? Number.MAX_SAFE_INTEGER).padStart(8, "0")}:${control.controlName.toLowerCase()}`
  );

const layoutClassHint = (control: CanvasControl): string => {
  const modeClassMap: Record<CanvasControl["normalizedLayout"]["inferredLayoutMode"], string> = {
    absolute: "layout-absolute absolute",
    verticalStack: "layout-vertical-stack flex flex-col gap-2",
    horizontalStack: "layout-horizontal-stack flex flex-row gap-2",
    grid: "layout-grid grid grid-cols-2 gap-2",
    galleryTemplate: "layout-gallery-template grid gap-2",
    formLayout: "layout-form-layout grid gap-3",
    unknown: "layout-unknown"
  };
  const responsiveClassMap: Record<CanvasControl["normalizedLayout"]["responsiveHint"], string> = {
    fixed: "responsive-fixed",
    stretch: "responsive-stretch",
    wrap: "responsive-wrap",
    fillParent: "responsive-fill-parent",
    unknown: "responsive-unknown"
  };

  return `${modeClassMap[control.normalizedLayout.inferredLayoutMode]} ${
    responsiveClassMap[control.normalizedLayout.responsiveHint]
  } canvas-role-${slugify(control.role)}`;
};

interface VisualRenderHints {
  styleEntries: Array<{ key: string; valueCode: string }>;
  comments: string[];
  hiddenPlaceholder: boolean;
  disabled: boolean;
  readOnly: boolean;
}

const isFormulaLikeValue = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (/^#?[a-zA-Z0-9-]+$/.test(trimmed) && !trimmed.includes("(")) {
    return false;
  }

  return /[A-Za-z_]+\(|\b(Self|Parent|ThisItem|If|Switch|LookUp|Patch|Color|RGBA)\b/.test(trimmed);
};

const getCanvasPropertyValue = (control: CanvasControl, propertyName: string): unknown => {
  const layoutValue = control.layoutProperties[propertyName as keyof typeof control.layoutProperties];
  if (layoutValue !== undefined) {
    return layoutValue;
  }

  return control.properties[propertyName];
};

const stringifyVisualProperties = (values: Record<string, unknown>): string =>
  safeComment(JSON.stringify(values));

const toQuotedCode = (value: string): string => `"${safeComment(value)}"`;

const parseNumericStyleValue = (
  control: CanvasControl,
  propertyName: string,
  value: unknown,
  styleKey: string,
  styleEntries: Array<{ key: string; valueCode: string }>,
  comments: string[],
  warnings: GenerationWarning[],
  context: GeneratorContext
): void => {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    styleEntries.push({ key: styleKey, valueCode: `${value}` });
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      styleEntries.push({ key: styleKey, valueCode: `${Number(trimmed)}` });
      return;
    }

    if (isFormulaLikeValue(trimmed)) {
      comments.push(`TODO: Convert Canvas property formula for ${propertyName}: ${trimmed}`);
      warnings.push(
        createWarning({
          code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
          message: `Property "${propertyName}" on control "${control.controlName}" is formula-based and needs manual conversion.`,
          sourceArtifactIds: [control.artifactId],
          sourceLocation: control.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
      return;
    }
  }

  warnings.push(
    createWarning({
      code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
      message: `Property "${propertyName}" on control "${control.controlName}" could not be safely converted to numeric style.`,
      sourceArtifactIds: [control.artifactId],
      sourceLocation: control.provenance.sourcePath,
      provenance: context.invocationProvenance
    })
  );
};

const parseStringStyleValue = (
  control: CanvasControl,
  propertyName: string,
  value: unknown,
  styleKey: string,
  styleEntries: Array<{ key: string; valueCode: string }>,
  comments: string[],
  warnings: GenerationWarning[],
  context: GeneratorContext
): void => {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }

    if (isFormulaLikeValue(trimmed)) {
      comments.push(`TODO: Convert Canvas property formula for ${propertyName}: ${trimmed}`);
      warnings.push(
        createWarning({
          code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
          message: `Property "${propertyName}" on control "${control.controlName}" is formula-based and needs manual conversion.`,
          sourceArtifactIds: [control.artifactId],
          sourceLocation: control.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
      return;
    }

    styleEntries.push({ key: styleKey, valueCode: toQuotedCode(trimmed) });
    return;
  }

  warnings.push(
    createWarning({
      code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
      message: `Property "${propertyName}" on control "${control.controlName}" could not be safely converted to string style.`,
      sourceArtifactIds: [control.artifactId],
      sourceLocation: control.provenance.sourcePath,
      provenance: context.invocationProvenance
    })
  );
};

const deriveVisualRenderHints = (
  control: CanvasControl,
  warnings: GenerationWarning[],
  context: GeneratorContext
): VisualRenderHints => {
  const styleEntries: Array<{ key: string; valueCode: string }> = [];
  const comments: string[] = [];
  const canvasVisualProps: Record<string, unknown> = {};
  const controlFormulaProperties = new Set(
    control.formulas
      .map((formula) => (formula.propertyName ?? "").trim().toLowerCase())
      .filter((propertyName) => propertyName.length > 0)
  );
  let hiddenPlaceholder = false;
  let disabled = false;
  let readOnly = false;
  const includeProperty = (propertyName: string): void => {
    const value = getCanvasPropertyValue(control, propertyName);
    if (value !== undefined) {
      canvasVisualProps[propertyName] = value;
    }
  };
  [
    "X",
    "Y",
    "Width",
    "Height",
    "Fill",
    "Color",
    "BorderColor",
    "BorderThickness",
    "BorderRadius",
    "Font",
    "FontWeight",
    "Size",
    "Align",
    "Padding",
    "Visible",
    "DisplayMode"
  ].forEach(includeProperty);

  if (Object.keys(canvasVisualProps).length > 0) {
    comments.push(`Canvas visual properties: ${stringifyVisualProperties(canvasVisualProps)}`);
  }

  const addFormulaTodoIfExplicit = (propertyName: string, value: unknown): boolean => {
    if (!controlFormulaProperties.has(propertyName.toLowerCase())) {
      return false;
    }

    comments.push(
      `TODO: Convert Canvas property formula for ${propertyName}: ${
        typeof value === "string" ? value : "[formula]"
      }`
    );
    warnings.push(
      createWarning({
        code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
        message: `Property "${propertyName}" on control "${control.controlName}" is formula-based and needs manual conversion.`,
        sourceArtifactIds: [control.artifactId],
        sourceLocation: control.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );

    return true;
  };

  const xValue = getCanvasPropertyValue(control, "X");
  const yValue = getCanvasPropertyValue(control, "Y");
  if (control.normalizedLayout.inferredLayoutMode === "absolute") {
    styleEntries.push({ key: "position", valueCode: toQuotedCode("absolute") });
    if (!addFormulaTodoIfExplicit("X", xValue)) {
      parseNumericStyleValue(
        control,
        "X",
        xValue,
        "left",
        styleEntries,
        comments,
        warnings,
        context
      );
    }
    if (!addFormulaTodoIfExplicit("Y", yValue)) {
      parseNumericStyleValue(
        control,
        "Y",
        yValue,
        "top",
        styleEntries,
        comments,
        warnings,
        context
      );
    }
  }

  const widthValue = getCanvasPropertyValue(control, "Width");
  if (!addFormulaTodoIfExplicit("Width", widthValue)) {
    parseNumericStyleValue(
      control,
      "Width",
      widthValue,
      "width",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const heightValue = getCanvasPropertyValue(control, "Height");
  if (!addFormulaTodoIfExplicit("Height", heightValue)) {
    parseNumericStyleValue(
      control,
      "Height",
      heightValue,
      "height",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const fillValue = getCanvasPropertyValue(control, "Fill");
  if (!addFormulaTodoIfExplicit("Fill", fillValue)) {
    parseStringStyleValue(
      control,
      "Fill",
      fillValue,
      "backgroundColor",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const colorValue = getCanvasPropertyValue(control, "Color");
  if (!addFormulaTodoIfExplicit("Color", colorValue)) {
    parseStringStyleValue(
      control,
      "Color",
      colorValue,
      "color",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const borderColorValue = getCanvasPropertyValue(control, "BorderColor");
  if (!addFormulaTodoIfExplicit("BorderColor", borderColorValue)) {
    parseStringStyleValue(
      control,
      "BorderColor",
      borderColorValue,
      "borderColor",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const borderThicknessValue = getCanvasPropertyValue(control, "BorderThickness");
  if (!addFormulaTodoIfExplicit("BorderThickness", borderThicknessValue)) {
    parseNumericStyleValue(
      control,
      "BorderThickness",
      borderThicknessValue,
      "borderWidth",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const borderRadiusValue = getCanvasPropertyValue(control, "BorderRadius");
  if (!addFormulaTodoIfExplicit("BorderRadius", borderRadiusValue)) {
    parseNumericStyleValue(
      control,
      "BorderRadius",
      borderRadiusValue,
      "borderRadius",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const fontValue = getCanvasPropertyValue(control, "Font");
  if (!addFormulaTodoIfExplicit("Font", fontValue)) {
    parseStringStyleValue(
      control,
      "Font",
      fontValue,
      "fontFamily",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const fontWeightValue = getCanvasPropertyValue(control, "FontWeight");
  if (!addFormulaTodoIfExplicit("FontWeight", fontWeightValue)) {
    if (fontWeightValue !== undefined && fontWeightValue !== null) {
      if (typeof fontWeightValue === "number") {
        styleEntries.push({ key: "fontWeight", valueCode: `${fontWeightValue}` });
      } else if (typeof fontWeightValue === "string") {
        const normalized = fontWeightValue.trim();
        if (isFormulaLikeValue(normalized)) {
          comments.push(`TODO: Convert Canvas property formula for FontWeight: ${normalized}`);
          warnings.push(
            createWarning({
              code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
              message: `Property "FontWeight" on control "${control.controlName}" is formula-based and needs manual conversion.`,
              sourceArtifactIds: [control.artifactId],
              sourceLocation: control.provenance.sourcePath,
              provenance: context.invocationProvenance
            })
          );
        } else {
          const mapped =
            normalized.toLowerCase() === "bold"
              ? "bold"
              : normalized.toLowerCase() === "normal"
                ? "normal"
                : normalized;
          styleEntries.push({ key: "fontWeight", valueCode: toQuotedCode(mapped.toLowerCase()) });
        }
      } else {
        warnings.push(
          createWarning({
            code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
            message: `Property "FontWeight" on control "${control.controlName}" could not be safely converted.`,
            sourceArtifactIds: [control.artifactId],
            sourceLocation: control.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      }
    }
  }

  const sizeValue = getCanvasPropertyValue(control, "Size");
  if (!addFormulaTodoIfExplicit("Size", sizeValue)) {
    parseNumericStyleValue(
      control,
      "Size",
      sizeValue,
      "fontSize",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const alignValue = getCanvasPropertyValue(control, "Align");
  if (!addFormulaTodoIfExplicit("Align", alignValue) && alignValue !== undefined && alignValue !== null) {
    if (typeof alignValue === "string") {
      const normalized = alignValue.trim().toLowerCase();
      if (isFormulaLikeValue(normalized)) {
        comments.push(`TODO: Convert Canvas property formula for Align: ${alignValue}`);
        warnings.push(
          createWarning({
            code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
            message: `Property "Align" on control "${control.controlName}" is formula-based and needs manual conversion.`,
            sourceArtifactIds: [control.artifactId],
            sourceLocation: control.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      } else {
        const mappedAlign: Record<string, string> = {
          center: "center",
          left: "left",
          right: "right",
          justify: "justify"
        };
        const aligned = mappedAlign[normalized];
        if (aligned) {
          styleEntries.push({ key: "textAlign", valueCode: toQuotedCode(aligned) });
        } else {
          warnings.push(
            createWarning({
              code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
              message: `Property "Align" value "${alignValue}" on control "${control.controlName}" is not a known safe textAlign mapping.`,
              sourceArtifactIds: [control.artifactId],
              sourceLocation: control.provenance.sourcePath,
              provenance: context.invocationProvenance
            })
          );
        }
      }
    } else {
      warnings.push(
        createWarning({
          code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
          message: `Property "Align" on control "${control.controlName}" could not be safely converted.`,
          sourceArtifactIds: [control.artifactId],
          sourceLocation: control.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
    }
  }

  const paddingValue = getCanvasPropertyValue(control, "Padding");
  if (!addFormulaTodoIfExplicit("Padding", paddingValue)) {
    parseNumericStyleValue(
      control,
      "Padding",
      paddingValue,
      "padding",
      styleEntries,
      comments,
      warnings,
      context
    );
  }

  const visibleValue = getCanvasPropertyValue(control, "Visible");
  if (!addFormulaTodoIfExplicit("Visible", visibleValue) && visibleValue !== undefined) {
    if (typeof visibleValue === "boolean") {
      if (!visibleValue) {
        hiddenPlaceholder = true;
        comments.push("Visible=false; control rendered as hidden-state placeholder in MVP.");
      }
    } else if (typeof visibleValue === "string") {
      const normalized = visibleValue.trim().toLowerCase();
      if (normalized === "false") {
        hiddenPlaceholder = true;
        comments.push("Visible=false; control rendered as hidden-state placeholder in MVP.");
      } else if (normalized !== "true") {
        if (isFormulaLikeValue(visibleValue)) {
          comments.push(`TODO: Convert Canvas property formula for Visible: ${visibleValue}`);
          warnings.push(
            createWarning({
              code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
              message: `Property "Visible" on control "${control.controlName}" is formula-based and needs manual conversion.`,
              sourceArtifactIds: [control.artifactId],
              sourceLocation: control.provenance.sourcePath,
              provenance: context.invocationProvenance
            })
          );
        } else {
          warnings.push(
            createWarning({
              code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
              message: `Property "Visible" value "${visibleValue}" on control "${control.controlName}" is not safely mappable.`,
              sourceArtifactIds: [control.artifactId],
              sourceLocation: control.provenance.sourcePath,
              provenance: context.invocationProvenance
            })
          );
        }
      }
    } else {
      warnings.push(
        createWarning({
          code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
          message: `Property "Visible" on control "${control.controlName}" could not be safely converted.`,
          sourceArtifactIds: [control.artifactId],
          sourceLocation: control.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
    }
  }

  const displayModeValue = getCanvasPropertyValue(control, "DisplayMode");
  if (!addFormulaTodoIfExplicit("DisplayMode", displayModeValue) && displayModeValue !== undefined) {
    if (typeof displayModeValue === "string") {
      const normalized = displayModeValue.trim().toLowerCase();
      if (isFormulaLikeValue(displayModeValue)) {
        comments.push(`TODO: Convert Canvas property formula for DisplayMode: ${displayModeValue}`);
        warnings.push(
          createWarning({
            code: "REACT_VISUAL_PROPERTY_FORMULA_TODO",
            message: `Property "DisplayMode" on control "${control.controlName}" is formula-based and needs manual conversion.`,
            sourceArtifactIds: [control.artifactId],
            sourceLocation: control.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      } else if (normalized.includes("disabled")) {
        disabled = true;
      } else if (normalized.includes("view") || normalized.includes("readonly")) {
        readOnly = true;
      } else if (!normalized.includes("edit")) {
        warnings.push(
          createWarning({
            code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
            message: `Property "DisplayMode" value "${displayModeValue}" on control "${control.controlName}" is not a known safe mapping.`,
            sourceArtifactIds: [control.artifactId],
            sourceLocation: control.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      }
    } else {
      warnings.push(
        createWarning({
          code: "REACT_VISUAL_PROPERTY_UNCERTAIN",
          message: `Property "DisplayMode" on control "${control.controlName}" could not be safely converted.`,
          sourceArtifactIds: [control.artifactId],
          sourceLocation: control.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
    }
  }

  return {
    styleEntries,
    comments: sortByStableKey(Array.from(new Set(comments)), (comment) => comment),
    hiddenPlaceholder,
    disabled,
    readOnly
  };
};

const styleAttributeCode = (
  indent: string,
  styleEntries: Array<{ key: string; valueCode: string }>
): string => {
  if (styleEntries.length === 0) {
    return "";
  }

  const body = styleEntries
    .map((entry) => `${indent}  ${entry.key}: ${entry.valueCode},`)
    .join("\n");

  return ` style={{
${body}
${indent}}}`;
};

type FormulaBucket =
  | "stateManagement"
  | "dataOperations"
  | "navigation"
  | "displayLogic"
  | "transformation"
  | "unknownComplex";

type ServiceModule = "dataService" | "navigationService" | "stateService" | "queryHelpers";

interface FormulaRecord {
  ownerLabel: string;
  functionName: string;
  formula: CanvasFormula;
}

interface FormulaAnalysis {
  functions: string[];
  bucket: FormulaBucket;
  services: ServiceModule[];
  stubLines: string[];
  warningCodes: string[];
  warningMessages: string[];
  unsupportedFunctions: string[];
  hotspotReasons: string[];
  azureApiHints: string[];
}

interface ScreenComponentResult {
  componentName: string;
  content: string;
  formulasClassified: number;
  stubsGenerated: number;
  unsupportedFormulas: number;
  manualConversionHotspots: number;
  bucketCounts: Record<FormulaBucket, number>;
  azureApiHints: string[];
  formulaHotspotNotes: string[];
  formulaHotspots: GenerationFormulaHotspot[];
}

const knownFunctionClassifications: Record<
  string,
  {
    bucket: FormulaBucket;
    services: ServiceModule[];
    stubLines: string[];
    azureApiHints: string[];
  }
> = {
  set: {
    bucket: "stateManagement",
    services: ["stateService"],
    stubLines: ['stateService.setState("TODO_STATE_KEY", undefined);'],
    azureApiHints: []
  },
  updatecontext: {
    bucket: "stateManagement",
    services: ["stateService"],
    stubLines: ["stateService.updateContext({});"],
    azureApiHints: []
  },
  clear: {
    bucket: "stateManagement",
    services: ["stateService"],
    stubLines: ['stateService.clearCollection("TODO_COLLECTION");'],
    azureApiHints: []
  },
  collect: {
    bucket: "stateManagement",
    services: ["stateService"],
    stubLines: ['stateService.collect("TODO_COLLECTION", []);'],
    azureApiHints: []
  },
  clearcollect: {
    bucket: "stateManagement",
    services: ["stateService"],
    stubLines: ['stateService.clearCollect("TODO_COLLECTION", []);'],
    azureApiHints: []
  },
  patch: {
    bucket: "dataOperations",
    services: ["dataService"],
    stubLines: ['await dataService.patchRecord("TODO_ENTITY", {});'],
    azureApiHints: ["Azure Functions API for create/update operations"]
  },
  submitform: {
    bucket: "dataOperations",
    services: ["dataService"],
    stubLines: ['await dataService.submitForm("TODO_FORM", {});'],
    azureApiHints: ["Azure Functions API for form submit workflows"]
  },
  remove: {
    bucket: "dataOperations",
    services: ["dataService"],
    stubLines: ['await dataService.removeRecord("TODO_ENTITY", "TODO_ID");'],
    azureApiHints: ["Azure Functions API for delete operations"]
  },
  removeif: {
    bucket: "dataOperations",
    services: ["dataService"],
    stubLines: ['await dataService.removeIf("TODO_ENTITY", "TODO_FILTER");'],
    azureApiHints: ["Azure Functions API for conditional deletes"]
  },
  lookup: {
    bucket: "dataOperations",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.lookupByPredicate([], () => true);"],
    azureApiHints: ["Azure query endpoint for lookup access patterns"]
  },
  filter: {
    bucket: "dataOperations",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.filterRecords([], () => true);"],
    azureApiHints: ["Azure query endpoint for filtered reads"]
  },
  search: {
    bucket: "dataOperations",
    services: ["queryHelpers"],
    stubLines: ['queryHelpers.searchRecords([], "TODO_QUERY");'],
    azureApiHints: ["Azure search/query API for text search"]
  },
  sort: {
    bucket: "dataOperations",
    services: ["queryHelpers"],
    stubLines: ['queryHelpers.sortRecords([], "TODO_FIELD");'],
    azureApiHints: ["Azure query endpoint with server/client sorting"]
  },
  sortbycolumns: {
    bucket: "dataOperations",
    services: ["queryHelpers"],
    stubLines: ['queryHelpers.sortByColumns([], ["TODO_FIELD"]);'],
    azureApiHints: ["Azure query endpoint with multi-column sorting"]
  },
  navigate: {
    bucket: "navigation",
    services: ["navigationService"],
    stubLines: ['navigationService.navigate(router, "/TODO_ROUTE");'],
    azureApiHints: []
  },
  back: {
    bucket: "navigation",
    services: ["navigationService"],
    stubLines: ["navigationService.back(router);"],
    azureApiHints: []
  },
  launch: {
    bucket: "navigation",
    services: ["navigationService"],
    stubLines: ['navigationService.launch("https://todo.example");'],
    azureApiHints: []
  },
  if: {
    bucket: "displayLogic",
    services: [],
    stubLines: ["// TODO: Convert conditional display logic (If) into derived UI state."],
    azureApiHints: []
  },
  switch: {
    bucket: "displayLogic",
    services: [],
    stubLines: ["// TODO: Convert branching display logic (Switch) into derived UI state."],
    azureApiHints: []
  },
  visible: {
    bucket: "displayLogic",
    services: [],
    stubLines: ["// TODO: Convert Visible expressions into conditional rendering."],
    azureApiHints: []
  },
  displaymode: {
    bucket: "displayLogic",
    services: [],
    stubLines: ["// TODO: Convert DisplayMode expressions into disabled/readOnly state."],
    azureApiHints: []
  },
  text: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.toText(undefined);"],
    azureApiHints: []
  },
  value: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.toValue(undefined);"],
    azureApiHints: []
  },
  concatenate: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ['queryHelpers.concatenate(["TODO_LEFT", "TODO_RIGHT"]);'],
    azureApiHints: []
  },
  datevalue: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ['queryHelpers.dateValue("TODO_DATE");'],
    azureApiHints: []
  },
  dateadd: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.dateAdd(new Date(), 1, \"days\");"],
    azureApiHints: []
  },
  countrows: {
    bucket: "transformation",
    services: ["queryHelpers"],
    stubLines: ["queryHelpers.countRows([]);"],
    azureApiHints: []
  }
};

const formulaBucketPriority: FormulaBucket[] = [
  "dataOperations",
  "stateManagement",
  "navigation",
  "displayLogic",
  "transformation",
  "unknownComplex"
];

const manualImplementationAreaByBucket: Record<FormulaBucket, string> = {
  stateManagement: "stateService + React state/reducer wiring",
  dataOperations: "dataService + queryHelpers integration",
  navigation: "navigationService + Next.js route wiring",
  displayLogic: "component conditional rendering and derived UI state",
  transformation: "queryHelpers value/format conversion helpers",
  unknownComplex: "manual Power Fx translation layer"
};

const recommendationByBucket: Record<FormulaBucket, string> = {
  stateManagement: "Define explicit state ownership and map Set/UpdateContext mutations to typed state APIs.",
  dataOperations:
    "Replace data formulas with explicit async service calls and contract-tested API adapters.",
  navigation: "Map navigation formulas to route helpers and verify path/state handoff behavior.",
  displayLogic:
    "Extract conditional UI logic into testable selectors before wiring component rendering branches.",
  transformation:
    "Move conversion and formatting logic into reusable helper functions with unit tests.",
  unknownComplex:
    "Treat this formula as manual migration work and split logic into smaller typed units."
};

const hotspotSeverity = (analysis: FormulaAnalysis): GenerationFormulaHotspot["severity"] => {
  if (
    analysis.unsupportedFunctions.length > 0 ||
    analysis.warningCodes.some((code) => code.startsWith("REACT_FORMULA_COMPLEXITY"))
  ) {
    return "high";
  }

  if (analysis.bucket === "dataOperations" || analysis.bucket === "stateManagement") {
    return "medium";
  }

  if (analysis.bucket === "unknownComplex") {
    return "high";
  }

  return "low";
};

const extractFormulaFunctions = (expression: string): string[] => {
  const matches = expression.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
  const ordered = Array.from(matches, (match) => match[1].toLowerCase());
  return sortByStableKey(Array.from(new Set(ordered)), (entry) => entry);
};

const countFunctionInvocations = (expression: string, functionName: string): number =>
  (expression.match(new RegExp(`\\b${functionName}\\s*\\(`, "gi")) ?? []).length;

const hasMultiSourceCollect = (expression: string): boolean => {
  const collectMatches = expression.matchAll(/\b(?:Collect|ClearCollect)\s*\(([^)]*)\)/gi);
  for (const match of collectMatches) {
    const args = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (args.length > 2) {
      return true;
    }
  }

  return false;
};

const analyzeFormulaExpression = (expression: string): FormulaAnalysis => {
  const functions = extractFormulaFunctions(expression);
  const buckets = new Set<FormulaBucket>();
  const services = new Set<ServiceModule>();
  const stubLines = new Set<string>();
  const warningCodes = new Set<string>();
  const warningMessages = new Set<string>();
  const unsupportedFunctions: string[] = [];
  const hotspotReasons = new Set<string>();
  const azureApiHints = new Set<string>();

  functions.forEach((functionName) => {
    const classification = knownFunctionClassifications[functionName];
    if (!classification) {
      unsupportedFunctions.push(functionName);
      return;
    }

    buckets.add(classification.bucket);
    classification.services.forEach((service) => services.add(service));
    classification.stubLines.forEach((line) => stubLines.add(line));
    classification.azureApiHints.forEach((hint) => azureApiHints.add(hint));
  });

  if (unsupportedFunctions.length > 0) {
    warningCodes.add("REACT_FORMULA_UNSUPPORTED_FUNCTION");
    warningMessages.add(
      `Formula uses unsupported functions (${unsupportedFunctions.join(", ")}); manual conversion required.`
    );
    hotspotReasons.add(
      `Unsupported functions detected: ${unsupportedFunctions.join(", ")}`
    );
  }

  const nestedLogicComplexity =
    countFunctionInvocations(expression, "if") + countFunctionInvocations(expression, "switch");
  if (nestedLogicComplexity > 1) {
    warningCodes.add("REACT_FORMULA_COMPLEXITY_NESTED_LOGIC");
    warningMessages.add(
      "Formula contains nested If/Switch logic and should be split into testable React helpers."
    );
    hotspotReasons.add("Nested If/Switch logic");
  }

  const patchInvocations = countFunctionInvocations(expression, "patch");
  if (patchInvocations > 1 || (patchInvocations > 0 && expression.includes(";"))) {
    warningCodes.add("REACT_FORMULA_COMPLEXITY_PATCH_CHAIN");
    warningMessages.add(
      "Formula contains chained Patch/data update logic and requires staged async migration."
    );
    hotspotReasons.add("Chained Patch/data updates");
  }

  if (hasMultiSourceCollect(expression)) {
    warningCodes.add("REACT_FORMULA_COMPLEXITY_MULTI_SOURCE_COLLECT");
    warningMessages.add(
      "Formula uses Collect/ClearCollect with multiple sources and needs explicit merge strategy."
    );
    hotspotReasons.add("Multi-source Collect usage");
  }

  if (
    /\b(?:Set|UpdateContext)\s*\(/i.test(expression) &&
    /\b(?:var|context|ctx)[A-Za-z0-9_]*/i.test(expression)
  ) {
    warningCodes.add("REACT_FORMULA_COMPLEXITY_AMBIGUOUS_STATE");
    warningMessages.add(
      "Formula mixes context/state mutation with ambiguous dependencies and needs state ownership design."
    );
    hotspotReasons.add("Ambiguous context/state dependencies");
  }

  let bucket: FormulaBucket = "unknownComplex";
  for (const candidate of formulaBucketPriority) {
    if (buckets.has(candidate)) {
      bucket = candidate;
      break;
    }
  }
  if (bucket === "unknownComplex" && stubLines.size === 0) {
    stubLines.add("// TODO: Manual Power Fx migration required; no direct stub mapping available yet.");
  }

  return {
    functions,
    bucket,
    services: sortByStableKey(Array.from(services), (service) => service),
    stubLines: sortByStableKey(Array.from(stubLines), (line) => line),
    warningCodes: sortByStableKey(Array.from(warningCodes), (code) => code),
    warningMessages: sortByStableKey(Array.from(warningMessages), (message) => message),
    unsupportedFunctions: sortByStableKey(unsupportedFunctions, (value) => value),
    hotspotReasons: sortByStableKey(Array.from(hotspotReasons), (reason) => reason),
    azureApiHints: sortByStableKey(Array.from(azureApiHints), (hint) => hint)
  };
};

const collectFormulaRecords = (screen: CanvasScreen): FormulaRecord[] => {
  const records: FormulaRecord[] = [];

  screen.formulas.forEach((formula, index) => {
    const property = formula.propertyName ?? `Formula${index + 1}`;
    records.push({
      ownerLabel: `screen:${screen.screenName}`,
      functionName: `handle${toPascalCase(screen.screenName)}${toPascalCase(property)}`,
      formula
    });
  });

  screen.controls.forEach((control) => {
    control.formulas.forEach((formula, index) => {
      const property = formula.propertyName ?? `Formula${index + 1}`;
      records.push({
        ownerLabel: `control:${control.controlName}`,
        functionName: `handle${toPascalCase(control.controlName)}${toPascalCase(property)}`,
        formula
      });
    });
  });

  return records;
};

const renderControl = (
  control: CanvasControl,
  controlsById: Map<string, CanvasControl>,
  formulaHandlerByControlId: Map<string, Map<string, string>>,
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[],
  context: GeneratorContext,
  depth = 2
): string => {
  const indent = "  ".repeat(depth);
  const childControls = sortControls(
    control.children
      .map((childId) => controlsById.get(childId))
      .filter((child): child is CanvasControl => Boolean(child))
  );
  const childMarkup = childControls
    .map((child) =>
      renderControl(
        child,
        controlsById,
        formulaHandlerByControlId,
        warnings,
        unsupportedFeatures,
        context,
        depth + 1
      )
    )
    .join("\n");
  const classHint = layoutClassHint(control);
  const layoutComment = `${indent}{/* Canvas layout: mode=${control.normalizedLayout.inferredLayoutMode}, responsive=${control.normalizedLayout.responsiveHint}, readiness=${control.migrationReadiness} */}`;
  const visualHints = deriveVisualRenderHints(control, warnings, context);
  const visualComments = visualHints.comments
    .map((comment) => `${indent}{/* ${safeComment(comment)} */}`)
    .join("\n");
  const styleAttribute = styleAttributeCode(indent, visualHints.styleEntries);
  const disabledAttribute = visualHints.disabled ? " disabled" : "";
  const readOnlyAttribute = visualHints.readOnly ? " readOnly" : "";
  const formulaHandlerByProperty =
    formulaHandlerByControlId.get(control.artifactId) ?? new Map<string, string>();
  const onSelectHandler = formulaHandlerByProperty.get("onselect");
  const onChangeHandler = formulaHandlerByProperty.get("onchange");
  const unsupportedRole = ["html", "customComponent", "unknown"].includes(control.role);

  if (unsupportedRole) {
    warnings.push(
      createWarning({
        code: "REACT_CONTROL_UNSUPPORTED_ROLE",
        message: `Control "${control.controlName}" uses unsupported role "${control.role}" and is rendered as placeholder.`,
        sourceArtifactIds: [control.artifactId],
        sourceLocation: control.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );
    unsupportedFeatures.push(
      createUnsupportedFeature({
        featureType: `canvas.control-role.${control.role}`,
        sourceLocation: control.provenance.sourcePath,
        reason: `Canvas control role "${control.role}" does not have a direct deterministic React mapping yet.`,
        suggestedRemediation:
          "Replace placeholder with a manually mapped React component during migration.",
        severity: control.migrationReadiness === "blocked" ? "high" : "medium",
        sourceArtifactIds: [control.artifactId],
        provenance: context.invocationProvenance
      })
    );

    return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<div className="${classHint} unsupported-control" data-control-name="${control.controlName}">
${indent}  {/* TODO: Unsupported Canvas control role "${control.role}" */}
${indent}  <p>TODO: Unsupported Canvas control role "${control.role}" for "${control.controlName}".</p>
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
  }

  if (visualHints.hiddenPlaceholder) {
    return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<div className="hidden-state-placeholder ${classHint}" data-control-name="${control.controlName}">
${indent}  <p>TODO: ${control.controlName} is hidden in Canvas (Visible=false).</p>
${indent}</div>`;
  }

  if (control.migrationReadiness === "blocked" || control.migrationReadiness === "low") {
    warnings.push(
      createWarning({
        code: "REACT_CONTROL_LOW_READINESS",
        message: `Control "${control.controlName}" has migration readiness "${control.migrationReadiness}" and requires manual conversion.`,
        sourceArtifactIds: [control.artifactId],
        sourceLocation: control.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );
  }

  const commonAttributes = `className="${classHint}" data-control-name="${control.controlName}"${styleAttribute}`;

  const wrap = (openTag: string, closeTag: string, inner: string): string =>
    `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}${openTag}
${inner}
${indent}${closeTag}`;

  const childOrPlaceholder = childMarkup.length > 0 ? childMarkup : `${indent}  <span />`;

  switch (control.role) {
    case "pageContainer":
      return wrap(`<main ${commonAttributes}>`, "</main>", childOrPlaceholder);
    case "sectionContainer":
      return wrap(`<section ${commonAttributes}>`, "</section>", childOrPlaceholder);
    case "card":
      return wrap(`<div ${commonAttributes}>`, "</div>", childOrPlaceholder);
    case "text":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<p ${commonAttributes}>${control.controlName}</p>`;
    case "heading":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<h2 ${commonAttributes}>${control.controlName}</h2>`;
    case "button":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<button ${commonAttributes}${disabledAttribute}${onSelectHandler ? ` onClick={${onSelectHandler}}` : ""}>${control.controlName}</button>`;
    case "input":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<input type="text" ${commonAttributes}${disabledAttribute}${readOnlyAttribute} placeholder="${control.controlName}"${
        onChangeHandler ? ` onChange={${onChangeHandler}}` : ""
      } />`;
    case "select":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<select ${commonAttributes}${disabledAttribute}${onChangeHandler ? ` onChange={${onChangeHandler}}` : ""}>
${indent}  <option value="">TODO: map options for ${control.controlName}</option>
${indent}</select>`;
    case "dateInput":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<input type="date" ${commonAttributes}${disabledAttribute}${readOnlyAttribute}${onChangeHandler ? ` onChange={${onChangeHandler}}` : ""} />`;
    case "gallery":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<div ${commonAttributes}>
${indent}  <p>Gallery placeholder for ${control.controlName}</p>
${indent}  <ul>
${indent}    <li>TODO: map gallery item template</li>
${indent}  </ul>
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
    case "form":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<form ${commonAttributes}>
${childMarkup || `${indent}  <p>TODO: map form fields</p>`}
${indent}</form>`;
    case "dataCard":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<div ${commonAttributes} data-card="true">
${indent}  <label>${control.controlName}</label>
${indent}  <input type="text" placeholder="TODO: map ${control.controlName}" />
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
    case "image":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<img ${commonAttributes} src="/placeholder-image.png" alt="${control.controlName}" />`;
    case "icon":
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<span ${commonAttributes}>[icon:${control.controlName}]</span>`;
    default:
      return `${layoutComment}
${visualComments ? `${visualComments}\n` : ""}${indent}<div ${commonAttributes}>
${indent}  <p>TODO: map ${control.controlName}</p>
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
  }
};

const createScreenComponent = (
  appName: string,
  appSlug: string,
  screen: CanvasScreen,
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[],
  context: GeneratorContext
): ScreenComponentResult => {
  const componentNameBase = toPascalCase(screen.screenName);
  const componentName = componentNameBase.endsWith("Screen")
    ? componentNameBase
    : `${componentNameBase}Screen`;
  const controlsById = new Map(screen.controls.map((control) => [control.artifactId, control]));
  const rootControls = sortControls(
    screen.controls.filter(
      (control) => !control.parentControl || !controlsById.has(control.parentControl)
    )
  );
  const formulaRecords = collectFormulaRecords(screen);
  const formulaAnalyses = formulaRecords.map((record) => ({
    record,
    analysis: analyzeFormulaExpression(record.formula.rawExpression)
  }));
  const formulaHandlers = formulaAnalyses
    .map(({ record, analysis }) => {
      const expression = safeComment(record.formula.rawExpression);
      const summary = analysis.functions.length > 0 ? analysis.functions.join(", ") : "unknown";
      const stubLines = analysis.stubLines.map((line) => `  ${line}`).join("\n");
      return `async function ${record.functionName}(): Promise<void> {
  // TODO: Convert Power Fx (${record.ownerLabel}${record.formula.propertyName ? `.${record.formula.propertyName}` : ""})
  // ${expression}
  // Classified bucket: ${analysis.bucket}
  // Detected functions: ${summary}
${stubLines}
}`;
    })
    .join("\n\n");
  const formulaHandlerMapByControl = new Map<
    string,
    Map<string, string>
  >();
  const importedServices = new Set<ServiceModule>();
  const bucketCounts: Record<FormulaBucket, number> = {
    stateManagement: 0,
    dataOperations: 0,
    navigation: 0,
    displayLogic: 0,
    transformation: 0,
    unknownComplex: 0
  };
  const azureApiHints = new Set<string>();
  const hotspotNotes = new Set<string>();
  const formulaHotspots: GenerationFormulaHotspot[] = [];
  let unsupportedFormulaCount = 0;

  formulaAnalyses.forEach(({ record, analysis }) => {
    const controlName =
      record.formula.ownerType === "control"
        ? record.ownerLabel.replace(/^control:/, "")
        : null;
    const propertyName = record.formula.propertyName ?? "UnknownProperty";
    formulaHotspots.push({
      screen: screen.screenName,
      control: controlName,
      property: propertyName,
      formulaBucket: analysis.bucket,
      originalPowerFx: record.formula.rawExpression,
      generatedStubName: record.functionName,
      likelyManualImplementationArea: manualImplementationAreaByBucket[analysis.bucket],
      severity: hotspotSeverity(analysis),
      recommendation: recommendationByBucket[analysis.bucket]
    });

    if (!record.formula.ownerArtifactId || record.formula.ownerType !== "control") {
      analysis.services.forEach((service) => importedServices.add(service));
      bucketCounts[analysis.bucket] += 1;
      if (analysis.unsupportedFunctions.length > 0) {
        unsupportedFormulaCount += 1;
      }
      analysis.azureApiHints.forEach((hint) => azureApiHints.add(hint));
      analysis.hotspotReasons.forEach((reason) =>
        hotspotNotes.add(
          `${record.ownerLabel}${record.formula.propertyName ? `.${record.formula.propertyName}` : ""}: ${reason}`
        )
      );
      analysis.warningCodes.forEach((warningCode, warningIndex) => {
        warnings.push(
          createWarning({
            code: warningCode,
            message:
              analysis.warningMessages[warningIndex] ??
              `Formula warning detected for ${record.ownerLabel}.`,
            sourceArtifactIds: [record.formula.artifactId],
            sourceLocation: record.formula.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      });
      if (analysis.unsupportedFunctions.length > 0) {
        unsupportedFeatures.push(
          createUnsupportedFeature({
            featureType: "canvas.formula.unsupported-function",
            sourceLocation: record.formula.provenance.sourcePath,
            reason: `Formula uses unsupported functions: ${analysis.unsupportedFunctions.join(", ")}`,
            suggestedRemediation:
              "Extract formula behavior into explicit TypeScript helper functions and integration tests.",
            severity: "medium",
            sourceArtifactIds: [record.formula.artifactId],
            provenance: context.invocationProvenance
          })
        );
      }
      return;
    }

    const controlMap =
      formulaHandlerMapByControl.get(record.formula.ownerArtifactId) ?? new Map<string, string>();
    controlMap.set((record.formula.propertyName ?? "").toLowerCase(), record.functionName);
    formulaHandlerMapByControl.set(record.formula.ownerArtifactId, controlMap);
    analysis.services.forEach((service) => importedServices.add(service));
    bucketCounts[analysis.bucket] += 1;
    if (analysis.unsupportedFunctions.length > 0) {
      unsupportedFormulaCount += 1;
    }
    analysis.azureApiHints.forEach((hint) => azureApiHints.add(hint));
    analysis.hotspotReasons.forEach((reason) =>
      hotspotNotes.add(
        `${record.ownerLabel}${record.formula.propertyName ? `.${record.formula.propertyName}` : ""}: ${reason}`
      )
    );
    analysis.warningCodes.forEach((warningCode, warningIndex) => {
      warnings.push(
        createWarning({
          code: warningCode,
          message:
            analysis.warningMessages[warningIndex] ??
            `Formula warning detected for ${record.ownerLabel}.`,
          sourceArtifactIds: [record.formula.artifactId],
          sourceLocation: record.formula.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
    });
    if (analysis.unsupportedFunctions.length > 0) {
      unsupportedFeatures.push(
        createUnsupportedFeature({
          featureType: "canvas.formula.unsupported-function",
          sourceLocation: record.formula.provenance.sourcePath,
          reason: `Formula uses unsupported functions: ${analysis.unsupportedFunctions.join(", ")}`,
          suggestedRemediation:
            "Extract formula behavior into explicit TypeScript helper functions and integration tests.",
          severity: "medium",
          sourceArtifactIds: [record.formula.artifactId],
          provenance: context.invocationProvenance
        })
      );
    }
  });

  const renderedControls = rootControls
    .map((control) =>
      renderControl(
        control,
        controlsById,
        formulaHandlerMapByControl,
        warnings,
        unsupportedFeatures,
        context
      )
    )
    .join("\n");
  const formulaCommentBlock = formulaRecords
    .map(
      (record) =>
        `  // ${record.ownerLabel}${record.formula.propertyName ? `.${record.formula.propertyName}` : ""}: ${safeComment(
          record.formula.rawExpression
        )}`
    )
    .join("\n");
  const orderedServiceImports = sortByStableKey(Array.from(importedServices), (service) => service)
    .map((service) => {
      const source = `../../lib/generated/services/${service}`;
      return `import { ${service} } from "${source}";`;
    })
    .join("\n");
  const content = `import React from "react";
${orderedServiceImports ? `${orderedServiceImports}\n` : ""}

export function ${componentName}(): JSX.Element {
  const router = {
    push: (path: string): void => {
      void path;
    },
    back: (): void => {
      // TODO: wire Next.js router back() in migration pass.
    }
  };

  // Logic migration stubs
${formulaHandlers ? `${formulaHandlers}\n\n` : ""}  // Power Fx formulas requiring manual conversion:
${formulaCommentBlock || "  // None."}

  // Layout scaffold
  return (
    <div className="canvas-screen-skeleton" data-app-name="${appName}" data-screen-name="${screen.screenName}">
${renderedControls || "      <p>TODO: map screen controls</p>"}
    </div>
  );
}
`;

  return {
    componentName,
    content,
    formulasClassified: formulaAnalyses.length,
    stubsGenerated: formulaAnalyses.length,
    unsupportedFormulas: unsupportedFormulaCount,
    manualConversionHotspots: hotspotNotes.size,
    bucketCounts,
    azureApiHints: sortByStableKey(Array.from(azureApiHints), (hint) => hint),
    formulaHotspotNotes: sortByStableKey(Array.from(hotspotNotes), (note) => note),
    formulaHotspots: sortByStableKey(
      formulaHotspots,
      (hotspot) =>
        `${hotspot.screen}:${hotspot.control ?? "(screen)"}:${hotspot.property}:${hotspot.generatedStubName}`
    )
  };
};

const createServiceScaffoldArtifacts = (
  appSlug: string,
  sourceArtifactIds: string[],
  context: GeneratorContext
): GeneratedArtifact[] => {
  const basePath = `${appSlug}/lib/generated/services`;
  const dataServiceContent = `export const dataService = {
  async patchRecord(entityName: string, payload: Record<string, unknown>): Promise<void> {
    // TODO: Implement API integration for Patch()
    void entityName;
    void payload;
  },
  async submitForm(formName: string, payload: Record<string, unknown>): Promise<void> {
    // TODO: Implement API integration for SubmitForm()
    void formName;
    void payload;
  },
  async removeRecord(entityName: string, id: string): Promise<void> {
    // TODO: Implement API integration for Remove()
    void entityName;
    void id;
  },
  async removeIf(entityName: string, filterExpression: string): Promise<void> {
    // TODO: Implement API integration for RemoveIf()
    void entityName;
    void filterExpression;
  }
};
`;
  const navigationServiceContent = `interface RouterLike {
  push(path: string): void;
  back(): void;
}

export const navigationService = {
  navigate(router: RouterLike, route: string): void {
    // TODO: Validate route mapping from Canvas Navigate()
    router.push(route);
  },
  back(router: RouterLike): void {
    // TODO: Map Canvas Back() semantics
    router.back();
  },
  launch(url: string): void {
    // TODO: Replace with secure navigation/open-in-new-tab policy
    void url;
  }
};
`;
  const stateServiceContent = `export const stateService = {
  setState(stateKey: string, value: unknown): void {
    // TODO: map Set() to React useState/zustand/reducer pattern
    void stateKey;
    void value;
  },
  updateContext(partialState: Record<string, unknown>): void {
    // TODO: map UpdateContext() to local screen-level state
    void partialState;
  },
  clearCollection(collectionName: string): void {
    // TODO: map Clear() to collection state reset
    void collectionName;
  },
  collect(collectionName: string, items: unknown[]): void {
    // TODO: map Collect() append behavior
    void collectionName;
    void items;
  },
  clearCollect(collectionName: string, items: unknown[]): void {
    // TODO: map ClearCollect() replace behavior
    void collectionName;
    void items;
  }
};
`;
  const queryHelpersContent = `export const queryHelpers = {
  filterRecords<T>(records: T[], predicate: (record: T) => boolean): T[] {
    // TODO: verify Filter() predicate translation
    return records.filter(predicate);
  },
  lookupByPredicate<T>(records: T[], predicate: (record: T) => boolean): T | undefined {
    // TODO: verify Lookup() fallback handling
    return records.find(predicate);
  },
  searchRecords<T>(records: T[], query: string): T[] {
    // TODO: replace with domain-specific search implementation
    void query;
    return records;
  },
  sortRecords<T>(records: T[], field: string): T[] {
    // TODO: implement deterministic Sort() mapping
    void field;
    return records;
  },
  sortByColumns<T>(records: T[], fields: string[]): T[] {
    // TODO: implement SortByColumns() mapping
    void fields;
    return records;
  },
  toText(value: unknown): string {
    // TODO: validate Text() formatting patterns
    return String(value ?? "");
  },
  toValue(value: unknown): number {
    // TODO: validate Value() parsing behavior
    return Number(value ?? 0);
  },
  concatenate(values: string[]): string {
    // TODO: validate Concatenate() null/blank behavior
    return values.join("");
  },
  dateValue(value: string): Date {
    // TODO: validate DateValue() timezone behavior
    return new Date(value);
  },
  dateAdd(value: Date, delta: number, unit: "days" | "hours" | "minutes"): Date {
    // TODO: validate DateAdd() unit conversion behavior
    const copy = new Date(value.getTime());
    if (unit === "days") {
      copy.setDate(copy.getDate() + delta);
    } else if (unit === "hours") {
      copy.setHours(copy.getHours() + delta);
    } else {
      copy.setMinutes(copy.getMinutes() + delta);
    }
    return copy;
  },
  countRows<T>(rows: T[]): number {
    // TODO: validate CountRows() delegation for remote collections
    return rows.length;
  }
};
`;

  return sortByStableKey(
    [
      {
        artifactId: `generated:react:${appSlug}:service-data`,
        artifactType: "typescript-service",
        filePath: `${basePath}/dataService.ts`,
        content: dataServiceContent
      },
      {
        artifactId: `generated:react:${appSlug}:service-navigation`,
        artifactType: "typescript-service",
        filePath: `${basePath}/navigationService.ts`,
        content: navigationServiceContent
      },
      {
        artifactId: `generated:react:${appSlug}:service-state`,
        artifactType: "typescript-service",
        filePath: `${basePath}/stateService.ts`,
        content: stateServiceContent
      },
      {
        artifactId: `generated:react:${appSlug}:service-query-helpers`,
        artifactType: "typescript-service",
        filePath: `${basePath}/queryHelpers.ts`,
        content: queryHelpersContent
      }
    ],
    (artifact) => artifact.filePath
  ).map((artifact) => ({
    ...artifact,
    sourceArtifactIds,
    warnings: [],
    provenance: context.invocationProvenance,
    confidence: 0.85
  }));
};

const uniqueArtifactIds = (values: Iterable<string>): string[] =>
  sortByStableKey(Array.from(new Set(values)), (value) => value);

const buildMigrationNotes = (
  appNotes: string[],
  formulaEntries: Array<{ owner: string; expression: string }>,
  bucketCounts: Record<FormulaBucket, number>,
  hotspotNotes: string[],
  azureApiHints: string[],
  formulaHotspots: GenerationFormulaHotspot[]
): string => {
  const lines: string[] = [];
  lines.push("# Canvas to React Migration Notes");
  lines.push("");
  lines.push(
    "These generated files are migration scaffolds and require manual conversion before production use."
  );
  lines.push("");
  lines.push("## Manual conversion priorities");
  lines.push("");
  lines.push(...(appNotes.length > 0 ? appNotes : ["- No specific warnings were generated."]));
  lines.push("");
  lines.push("## Preserved Power Fx formulas (manual conversion required)");
  lines.push("");
  if (formulaEntries.length === 0) {
    lines.push("- None.");
  } else {
    formulaEntries.forEach((entry) => {
      lines.push(`- ${entry.owner}: \`${safeComment(entry.expression)}\``);
    });
  }
  lines.push("");
  lines.push("## Formula conversion summary");
  lines.push("");
  lines.push(`- stateManagement: ${bucketCounts.stateManagement}`);
  lines.push(`- dataOperations: ${bucketCounts.dataOperations}`);
  lines.push(`- navigation: ${bucketCounts.navigation}`);
  lines.push(`- displayLogic: ${bucketCounts.displayLogic}`);
  lines.push(`- transformation: ${bucketCounts.transformation}`);
  lines.push(`- unknownComplex: ${bucketCounts.unknownComplex}`);
  lines.push("");
  lines.push("## manual implementation hotspots");
  lines.push("");
  if (hotspotNotes.length === 0) {
    lines.push("- None.");
  } else {
    hotspotNotes.forEach((note) => lines.push(`- ${note}`));
  }
  lines.push("");
  lines.push("## Formula hotspot plan");
  lines.push("");
  if (formulaHotspots.length === 0) {
    lines.push("- None.");
  } else {
    formulaHotspots.forEach((hotspot) => {
      lines.push(
        `- [${hotspot.severity}] screen=${hotspot.screen} control=${hotspot.control ?? "(screen)"} property=${
          hotspot.property
        } bucket=${hotspot.formulaBucket}`
      );
      lines.push(`  - original Power Fx: \`${safeComment(hotspot.originalPowerFx)}\``);
      lines.push(`  - generated stub: \`${hotspot.generatedStubName}\``);
      lines.push(`  - likely manual area: ${hotspot.likelyManualImplementationArea}`);
      lines.push(`  - recommendation: ${hotspot.recommendation}`);
    });
  }
  lines.push("");
  lines.push("## likely Azure API requirements");
  lines.push("");
  if (azureApiHints.length === 0) {
    lines.push("- None identified in this pass.");
  } else {
    azureApiHints.forEach((hint) => lines.push(`- ${hint}`));
  }
  lines.push("");
  lines.push("## state-management complexity");
  lines.push("");
  lines.push(
    `- state formulas (Set/UpdateContext/Clear/Collect/ClearCollect): ${bucketCounts.stateManagement}`
  );
  lines.push(
    "- confirm ownership boundaries between local component state, shared client state, and server data."
  );
  lines.push("");
  lines.push("## recommended implementation strategy");
  lines.push("");
  lines.push(
    "- migrate handlers in thin vertical slices: classify formula -> service/query helper stub -> integration test -> UI wiring."
  );
  lines.push(
    "- prioritize hotspots first (unsupported functions, nested logic, chained data writes, and ambiguous state dependencies)."
  );
  lines.push("");
  lines.push(
    "Each TODO marker in generated components highlights a formula or control that needs manual conversion."
  );

  return lines.join("\n");
};

const buildGenerationReport = (
  output: CanvasReactGenerationOutput,
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[]
): string => {
  const lines: string[] = [];
  lines.push("# Power Exit React Generation Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Apps generated: ${output.appsGenerated}`);
  lines.push(`- Screens generated: ${output.screensGenerated}`);
  lines.push(`- Controls generated: ${output.controlsGenerated}`);
  lines.push(`- Formulas preserved: ${output.formulasPreserved}`);
  lines.push(`- Formulas classified: ${output.formulasClassified}`);
  lines.push(`- Stub handlers generated: ${output.stubsGenerated}`);
  lines.push(`- Unsupported formulas: ${output.unsupportedFormulas}`);
  lines.push(`- Manual conversion hotspots: ${output.manualConversionHotspots}`);
  lines.push(`- Unsupported controls: ${output.unsupportedControls}`);
  lines.push(`- Warnings: ${output.warnings}`);
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- None.");
  } else {
    sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`).forEach((warning) => {
      lines.push(`- [${warning.code}] ${warning.message}`);
    });
  }
  lines.push("");
  lines.push("## Unsupported features");
  lines.push("");
  if (unsupportedFeatures.length === 0) {
    lines.push("- None.");
  } else {
    sortByStableKey(
      unsupportedFeatures,
      (unsupportedFeature) => `${unsupportedFeature.severity}:${unsupportedFeature.featureType}`
    ).forEach((unsupportedFeature) => {
      lines.push(
        `- [${unsupportedFeature.severity}] ${unsupportedFeature.featureType}: ${unsupportedFeature.reason}`
      );
    });
  }

  return `${lines.join("\n")}\n`;
};

export const generateCanvasReactArtifacts = async (
  canvasApps: CanvasAppsSection,
  contextInput?: GeneratorContext
): Promise<GenerationResult<CanvasReactGenerationOutput>> => {
  const context = contextInput ?? defaultContext();
  const warnings: GenerationWarning[] = [];
  const unsupportedFeatures: GenerationUnsupportedFeature[] = [];
  const artifacts: GeneratedArtifact[] = [];
  const appNotes: string[] = [];
  const formulaEntries: Array<{ owner: string; expression: string }> = [];
  const hotspotNotes = new Set<string>();
  const azureApiHints = new Set<string>();
  const formulaHotspots: GenerationFormulaHotspot[] = [];
  const aggregateBucketCounts: Record<FormulaBucket, number> = {
    stateManagement: 0,
    dataOperations: 0,
    navigation: 0,
    displayLogic: 0,
    transformation: 0,
    unknownComplex: 0
  };
  let screensGenerated = 0;
  let controlsGenerated = 0;
  let formulasPreserved = 0;
  let formulasClassified = 0;
  let stubsGenerated = 0;
  let unsupportedFormulas = 0;
  let manualConversionHotspots = 0;
  let unsupportedControls = 0;

  const sortedApps = sortByStableKey(canvasApps, (app) => app.appName.toLowerCase());

  sortedApps.forEach((app) => {
    const appSlug = slugify(app.appName);
    const appScreens = sortScreens(app.screens);
    const sourceArtifactIds = uniqueArtifactIds([
      app.artifactId,
      ...appScreens.map((screen) => screen.artifactId),
      ...appScreens.flatMap((screen) => screen.controls.map((control) => control.artifactId))
    ]);
    const layoutContent = `import React from "react";

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
`;

    artifacts.push({
      artifactId: `generated:react:${appSlug}:layout`,
      artifactType: "react-layout",
      filePath: `${appSlug}/app/layout.tsx`,
      content: layoutContent,
      sourceArtifactIds,
      warnings: [],
      provenance: context.invocationProvenance,
      confidence: 0.85
    });
    createServiceScaffoldArtifacts(appSlug, sourceArtifactIds, context).forEach((artifact) => {
      artifacts.push(artifact);
    });

    appScreens.forEach((screen, index) => {
      screensGenerated += 1;
      controlsGenerated += screen.controls.length;
      formulasPreserved +=
        screen.formulas.length +
        screen.controls.reduce((count, control) => count + control.formulas.length, 0);
      unsupportedControls += screen.controls.filter((control) =>
        ["html", "customComponent", "unknown"].includes(control.role)
      ).length;

      const screenSlug = toScreenFileSlug(screen.screenName);
      const routeSlug = toRouteSlug(screen.screenName);
      const component = createScreenComponent(
        app.appName,
        appSlug,
        screen,
        warnings,
        unsupportedFeatures,
        context
      );
      formulasClassified += component.formulasClassified;
      stubsGenerated += component.stubsGenerated;
      unsupportedFormulas += component.unsupportedFormulas;
      manualConversionHotspots += component.manualConversionHotspots;
      component.azureApiHints.forEach((hint) => azureApiHints.add(hint));
      component.formulaHotspotNotes.forEach((note) => hotspotNotes.add(note));
      component.formulaHotspots.forEach((hotspot) => formulaHotspots.push(hotspot));
      (Object.keys(component.bucketCounts) as FormulaBucket[]).forEach((bucket) => {
        aggregateBucketCounts[bucket] += component.bucketCounts[bucket];
      });

      const componentArtifactPath = `${appSlug}/components/generated/${screenSlug}.tsx`;
      artifacts.push({
        artifactId: `generated:react:${appSlug}:${screenSlug}:component`,
        artifactType: "react-component",
        filePath: componentArtifactPath,
        content: component.content,
        sourceArtifactIds: uniqueArtifactIds([
          ...sourceArtifactIds,
          screen.artifactId,
          ...screen.controls.map((control) => control.artifactId)
        ]),
        warnings: warnings.filter((warning) =>
          warning.sourceArtifactIds.some((artifactId) =>
            [screen.artifactId, ...screen.controls.map((control) => control.artifactId)].includes(
              artifactId
            )
          )
        ),
        provenance: context.invocationProvenance,
        confidence: screen.confidence
      });

      const importPath = index === 0 ? `../components/generated/${screenSlug}` : `../../components/generated/${screenSlug}`;
      const routeFile = index === 0 ? `${appSlug}/app/page.tsx` : `${appSlug}/app/${routeSlug}/page.tsx`;
      const routeContent = `import React from "react";

import { ${component.componentName} } from "${importPath}";

export default function Page(): JSX.Element {
  return <${component.componentName} />;
}
`;

      artifacts.push({
        artifactId: `generated:react:${appSlug}:${routeSlug}:route`,
        artifactType: "react-route",
        filePath: routeFile,
        content: routeContent,
        sourceArtifactIds: uniqueArtifactIds([app.artifactId, screen.artifactId]),
        warnings: [],
        provenance: context.invocationProvenance,
        confidence: 0.9
      });

      if (screen.migrationReadiness === "blocked" || screen.migrationReadiness === "low") {
        appNotes.push(
          `- Screen "${screen.screenName}" in app "${app.appName}" has readiness "${screen.migrationReadiness}" and needs manual conversion.`
        );
      }

      screen.formulas.forEach((formula) => {
        formulaEntries.push({
          owner: `screen:${screen.screenName}`,
          expression: formula.rawExpression
        });
      });
      screen.controls.forEach((control) => {
        if (control.migrationReadiness === "blocked" || control.migrationReadiness === "low") {
          appNotes.push(
            `- Control "${control.controlName}" in screen "${screen.screenName}" has readiness "${control.migrationReadiness}" and needs manual conversion.`
          );
        }
        control.formulas.forEach((formula) => {
          formulaEntries.push({
            owner: `control:${control.controlName}`,
            expression: formula.rawExpression
          });
        });
      });
    });

    app.formulas.forEach((formula) => {
      const analysis = analyzeFormulaExpression(formula.rawExpression);
      formulasClassified += 1;
      aggregateBucketCounts[analysis.bucket] += 1;
      if (analysis.unsupportedFunctions.length > 0) {
        unsupportedFormulas += 1;
      }
      if (analysis.hotspotReasons.length > 0) {
        manualConversionHotspots += 1;
      }
      analysis.azureApiHints.forEach((hint) => azureApiHints.add(hint));
      analysis.hotspotReasons.forEach((reason) =>
        hotspotNotes.add(`app:${app.appName}.${formula.propertyName ?? "Formula"}: ${reason}`)
      );
      formulaHotspots.push({
        screen: `app:${app.appName}`,
        control: null,
        property: formula.propertyName ?? "Formula",
        formulaBucket: analysis.bucket,
        originalPowerFx: formula.rawExpression,
        generatedStubName: `handle${toPascalCase(app.appName)}${toPascalCase(
          formula.propertyName ?? "Formula"
        )}`,
        likelyManualImplementationArea: manualImplementationAreaByBucket[analysis.bucket],
        severity: hotspotSeverity(analysis),
        recommendation: recommendationByBucket[analysis.bucket]
      });
      analysis.warningCodes.forEach((warningCode, warningIndex) => {
        warnings.push(
          createWarning({
            code: warningCode,
            message:
              analysis.warningMessages[warningIndex] ??
              `Formula warning detected for app:${app.appName}.`,
            sourceArtifactIds: [formula.artifactId],
            sourceLocation: formula.provenance.sourcePath,
            provenance: context.invocationProvenance
          })
        );
      });
      if (analysis.unsupportedFunctions.length > 0) {
        unsupportedFeatures.push(
          createUnsupportedFeature({
            featureType: "canvas.formula.unsupported-function",
            sourceLocation: formula.provenance.sourcePath,
            reason: `Formula uses unsupported functions: ${analysis.unsupportedFunctions.join(", ")}`,
            suggestedRemediation:
              "Extract app-level startup/initialization logic into typed service modules.",
            severity: "medium",
            sourceArtifactIds: [formula.artifactId],
            provenance: context.invocationProvenance
          })
        );
      }
      formulaEntries.push({
        owner: `app:${app.appName}`,
        expression: formula.rawExpression
      });
    });
    formulasPreserved += app.formulas.length;
  });

  const output: CanvasReactGenerationOutput = {
    appsGenerated: sortedApps.length,
    screensGenerated,
    controlsGenerated,
    formulasPreserved,
    formulasClassified,
    stubsGenerated,
    unsupportedFormulas,
    manualConversionHotspots,
    formulaHotspots: sortByStableKey(
      formulaHotspots,
      (hotspot) =>
        `${hotspot.screen}:${hotspot.control ?? "(screen)"}:${hotspot.property}:${hotspot.generatedStubName}`
    ),
    unsupportedControls,
    warnings: warnings.length
  };
  const generationReport = buildGenerationReport(output, warnings, unsupportedFeatures);
  const migrationNotes = buildMigrationNotes(
    sortByStableKey(appNotes, (note) => note),
    sortByStableKey(formulaEntries, (entry) => `${entry.owner}:${entry.expression}`),
    aggregateBucketCounts,
    sortByStableKey(Array.from(hotspotNotes), (note) => note),
    sortByStableKey(Array.from(azureApiHints), (hint) => hint),
    output.formulaHotspots
  );
  const sourceArtifactIds = uniqueArtifactIds([
    ...sortedApps.map((app) => app.artifactId),
    ...sortedApps.flatMap((app) => app.screens.map((screen) => screen.artifactId)),
    ...sortedApps.flatMap((app) =>
      app.screens.flatMap((screen) => screen.controls.map((control) => control.artifactId))
    )
  ]);
  artifacts.push({
    artifactId: "generated:react:migration-notes",
    artifactType: "markdown-report",
    filePath: "migration-notes.md",
    content: migrationNotes,
    sourceArtifactIds,
    warnings: warnings,
    provenance: context.invocationProvenance,
    confidence: 0.85
  });
  artifacts.push({
    artifactId: "generated:react:generation-report",
    artifactType: "markdown-report",
    filePath: "generation-report.md",
    content: generationReport,
    sourceArtifactIds,
    warnings: warnings,
    provenance: context.invocationProvenance,
    confidence: 0.85
  });
  const parsedResult = createGenerationResultSchema(reactGenerationOutputSchema).parse({
    artifacts: sortByStableKey(artifacts, (artifact) => artifact.filePath),
    output,
    warnings: sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`),
    unsupportedFeatures: sortByStableKey(
      unsupportedFeatures,
      (unsupportedFeature) => `${unsupportedFeature.severity}:${unsupportedFeature.featureType}`
    ),
    confidence: Math.max(0, Math.min(1, 1 - warnings.length * 0.01 - unsupportedFeatures.length * 0.03)),
    provenance: context.invocationProvenance
  });

  return parsedResult as GenerationResult<CanvasReactGenerationOutput>;
};

export const generateCanvasReactFromPowerPlatformIR = async (
  input: unknown,
  contextInput?: GeneratorContext
): Promise<GenerationResult<CanvasReactGenerationOutput>> => {
  const validated = validatePowerPlatformIR(input);
  const context = contextInput ?? defaultContext();

  return generateCanvasReactArtifacts(validated.canvasApps, context);
};
