export interface BootstrapMetadata {
  packageName: string;
  packageVersion: string;
}

export const createBootstrapMetadata = (): BootstrapMetadata => ({
  packageName: "@power-exit/ir",
  packageVersion: "0.1.0"
});

export { sortByStableKey, stableStringify } from "./deterministic";
