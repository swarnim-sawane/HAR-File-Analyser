import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const assetsDirectory = path.resolve('dist', 'assets');
const forbiddenProductionEndpoints = [
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://10.65.39.163:4000',
];

const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((name) => name.endsWith('.js'));
const violations = [];

for (const assetName of javascriptAssets) {
  const assetPath = path.join(assetsDirectory, assetName);
  const contents = await readFile(assetPath, 'utf8');

  for (const endpoint of forbiddenProductionEndpoints) {
    if (contents.includes(endpoint)) {
      violations.push(`${assetName}: ${endpoint}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Frontend build contains development-only API endpoints:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Verified ${javascriptAssets.length} frontend asset(s): no development API endpoints.`);
