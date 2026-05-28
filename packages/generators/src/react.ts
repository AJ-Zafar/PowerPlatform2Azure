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
    absolute: "layout-absolute relative",
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
${indent}<div className="${classHint} unsupported-control" data-control-name="${control.controlName}">
${indent}  {/* TODO: Unsupported Canvas control role "${control.role}" */}
${indent}  <p>TODO: Unsupported Canvas control role "${control.role}" for "${control.controlName}".</p>
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
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

  const commonAttributes = `className="${classHint}" data-control-name="${control.controlName}"`;

  const wrap = (openTag: string, closeTag: string, inner: string): string =>
    `${layoutComment}
${indent}${openTag}
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
${indent}<p ${commonAttributes}>${control.controlName}</p>`;
    case "heading":
      return `${layoutComment}
${indent}<h2 ${commonAttributes}>${control.controlName}</h2>`;
    case "button":
      return `${layoutComment}
${indent}<button ${commonAttributes}${onSelectHandler ? ` onClick={${onSelectHandler}}` : ""}>${control.controlName}</button>`;
    case "input":
      return `${layoutComment}
${indent}<input type="text" ${commonAttributes} placeholder="${control.controlName}"${
        onChangeHandler ? ` onChange={${onChangeHandler}}` : ""
      } />`;
    case "select":
      return `${layoutComment}
${indent}<select ${commonAttributes}${onChangeHandler ? ` onChange={${onChangeHandler}}` : ""}>
${indent}  <option value="">TODO: map options for ${control.controlName}</option>
${indent}</select>`;
    case "dateInput":
      return `${layoutComment}
${indent}<input type="date" ${commonAttributes}${onChangeHandler ? ` onChange={${onChangeHandler}}` : ""} />`;
    case "gallery":
      return `${layoutComment}
${indent}<div ${commonAttributes}>
${indent}  <p>Gallery placeholder for ${control.controlName}</p>
${indent}  <ul>
${indent}    <li>TODO: map gallery item template</li>
${indent}  </ul>
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
    case "form":
      return `${layoutComment}
${indent}<form ${commonAttributes}>
${childMarkup || `${indent}  <p>TODO: map form fields</p>`}
${indent}</form>`;
    case "dataCard":
      return `${layoutComment}
${indent}<div ${commonAttributes} data-card="true">
${indent}  <label>${control.controlName}</label>
${indent}  <input type="text" placeholder="TODO: map ${control.controlName}" />
${childMarkup ? `${childMarkup}\n` : ""}${indent}</div>`;
    case "image":
      return `${layoutComment}
${indent}<img ${commonAttributes} src="/placeholder-image.png" alt="${control.controlName}" />`;
    case "icon":
      return `${layoutComment}
${indent}<span ${commonAttributes}>[icon:${control.controlName}]</span>`;
    default:
      return `${layoutComment}
${indent}<div ${commonAttributes}>
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
