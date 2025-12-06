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
export const MODELS_DIR = resolve(PROJECT_ROOT, ".models");

/**
 * Core package source directory.
 */
export const CORE_SRC_DIR = resolve(PROJECT_ROOT, "projects/core/src");

/**
 * Transformers.js cache directory for ASR models.
 */
export const TRANSFORMERS_CACHE_DIR = resolve(MODELS_DIR, "transformers-cache");

/**
 * Whether to run integration tests that require real model downloads.
 * Set RUN_INTEGRATION_TESTS=true to enable.
 * These tests are slow (5-10 min) and require network access.
 */
export const RUN_INTEGRATION_TESTS =
  process.env.RUN_INTEGRATION_TESTS === "true";

/**
 * Helper to conditionally describe integration test suites.
 * Skips the suite unless RUN_INTEGRATION_TESTS is enabled.
 */
export const describeIntegration = RUN_INTEGRATION_TESTS
  ? describe
  : describe.skip;
