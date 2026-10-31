/**
 * @module FeatureTypes
 * @description Model registry (registry.json) types.
 * @license GPL-3.0-only
 */

// ── Model Registry (from registry.json) ──────────────────

export interface ModelVariantFormat {
  url: string;
  size_mb: number;
  sha256: string;
}

export interface ModelVariant {
  variant: string;
  input_size: string;
  min_tops: number;
  formats: Record<string, ModelVariantFormat>;
}

export interface RegistryModel {
  id: string;
  name: string;
  description: string;
  license: string;
  classes: string[];
  variants: ModelVariant[];
}

export interface ModelRegistry {
  version: number;
  models: RegistryModel[];
}

export interface ModelDownloadStatus {
  model_id: string;
  state: "idle" | "downloading" | "verifying" | "complete" | "error";
  progress: number;
  error?: string;
}
