import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertExpectedApiUrl,
  assertNoFrontendSecrets,
  expectedVercelRuntime,
  formatVercelBuildFailure,
  validateFunctionConfigs,
  validateVercelOutputConfig
} from './vercel-build-contract.mjs';
import { loadExpectedApiUrl } from './vercel-build-env.mjs';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(frontendRoot, '.vercel', 'output');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs', '.txt']);

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectTextFilePaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedPaths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTextFilePaths(path);
      }
      return textExtensions.has(extname(entry.name)) ? [path] : [];
    })
  );

  return nestedPaths.flat();
}

async function checkVercelBuildOutput() {
  const expectedApiUrl = loadExpectedApiUrl(frontendRoot);
  const config = JSON.parse(await readFile(join(outputRoot, 'config.json'), 'utf8'));
  const artifactPaths = await collectTextFilePaths(outputRoot);
  const artifactContents = await Promise.all(artifactPaths.map((path) => readFile(path, 'utf8')));
  const functionConfigPaths = artifactPaths.filter((path) => path.endsWith('.vc-config.json'));
  const functionConfigs = await Promise.all(
    functionConfigPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8')))
  );

  validateVercelOutputConfig(config);
  validateFunctionConfigs(functionConfigs, expectedVercelRuntime);
  assertExpectedApiUrl(artifactContents, expectedApiUrl);
  assertNoFrontendSecrets(artifactContents);
}

try {
  await checkVercelBuildOutput();
  console.log('Vercel Preview build契約を確認しました');
} catch (error) {
  console.error(formatVercelBuildFailure(error));
  process.exitCode = 1;
}
