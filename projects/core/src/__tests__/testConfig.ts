/**
 * Test configuration and utilities.
 * Provides consistent paths and settings for all tests.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the project root directory by walking up from this file.
 * This is more robust than using relative paths from each test file.
 */
function findProjectRoot(): string {
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  // From src/__tests__ -> src -> core -> projects -> voice-bridge
  return resolve(thisDir, "../../../..");
}

/**
 * Project root directory (voice-bridge/).
 */
export const PROJECT_ROOT = findProjectRoot();

/**
 * Models directory for downloaded ML models.
 */
export const MODELS_DIR = resolve(PROJECT_ROOT, "models");

/**
 * Core package source directory.
 */
export const CORE_SRC_DIR = resolve(PROJECT_ROOT, "projects/core/src");

/**
 * Transformers.js cache directory for ASR models.
 */
export const TRANSFORMERS_CACHE_DIR = resolve(MODELS_DIR, "transformers-cache");
