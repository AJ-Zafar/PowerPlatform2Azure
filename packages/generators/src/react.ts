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
  type GenerationResult,
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

const collectFormulaRecords = (screen: CanvasScreen): Array<{
  ownerLabel: string;
  functionName: string;
  formula: CanvasFormula;
}> => {
  const records: Array<{
    ownerLabel: string;
    functionName: string;
    formula: CanvasFormula;
  }> = [];

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
  screen: CanvasScreen,
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[],
  context: GeneratorContext
): { componentName: string; content: string } => {
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
  const formulaHandlers = formulaRecords
    .map((record) => {
      const expression = safeComment(record.formula.rawExpression);
      return `function ${record.functionName}() {
  // TODO: Convert Power Fx (${record.ownerLabel}${record.formula.propertyName ? `.${record.formula.propertyName}` : ""})
  // ${expression}
}`;
    })
    .join("\n\n");
  const formulaHandlerMapByControl = new Map<
    string,
    Map<string, string>
  >();

  formulaRecords.forEach((record) => {
    if (!record.formula.ownerArtifactId || record.formula.ownerType !== "control") {
      return;
    }

    const controlMap =
      formulaHandlerMapByControl.get(record.formula.ownerArtifactId) ?? new Map<string, string>();
    controlMap.set((record.formula.propertyName ?? "").toLowerCase(), record.functionName);
    formulaHandlerMapByControl.set(record.formula.ownerArtifactId, controlMap);
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
  const content = `import React from "react";

export function ${componentName}(): JSX.Element {
${formulaHandlers ? `${formulaHandlers}\n\n` : ""}  // Power Fx formulas requiring manual conversion:
${formulaCommentBlock || "  // None."}

  return (
    <div className="canvas-screen-skeleton" data-app-name="${appName}" data-screen-name="${screen.screenName}">
${renderedControls || "      <p>TODO: map screen controls</p>"}
    </div>
  );
}
`;

  return {
    componentName,
    content
  };
};

const uniqueArtifactIds = (values: Iterable<string>): string[] =>
  sortByStableKey(Array.from(new Set(values)), (value) => value);

const buildMigrationNotes = (
  appNotes: string[],
  formulaEntries: Array<{ owner: string; expression: string }>
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
  let screensGenerated = 0;
  let controlsGenerated = 0;
  let formulasPreserved = 0;
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
        screen,
        warnings,
        unsupportedFeatures,
        context
      );

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
    unsupportedControls,
    warnings: warnings.length
  };
  const generationReport = buildGenerationReport(output, warnings, unsupportedFeatures);
  const migrationNotes = buildMigrationNotes(
    sortByStableKey(appNotes, (note) => note),
    sortByStableKey(formulaEntries, (entry) => `${entry.owner}:${entry.expression}`)
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
