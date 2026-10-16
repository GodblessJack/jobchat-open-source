#!/usr/bin/env node
// Risk-based npm audit: production findings fail, while only explicitly
// documented development-tool advisories may remain in the full audit.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const modules = ['.', 'jchat', 'meeting', 'landing'];
const allowedDevelopmentAdvisories = new Set([
  // Build-only glob processing; no user-controlled patterns in the release pipeline.
  'GHSA-vfj7-8cjw-p6xm', // braces
  // Development-server only; never exposed in the production deployment.
  'GHSA-67mh-4wv8-2f99', // esbuild dev-server request handling
  'GHSA-g7r4-m6w7-qqqr', // esbuild Windows dev-server file read
]);
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const failures = [];
const exceptions = [];

function audit(moduleDir, omitDev) {
  const args = ['audit', '--json'];
  if (omitDev) args.push('--omit=dev');
  const result = spawnSync('npm', args, {
    cwd: path.join(rootDir, moduleDir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit failed for ${moduleDir}: ${result.stderr || result.stdout}`);
  }

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (typeof via !== 'object') continue;
      const severity = via.severity || vulnerability.severity || 'info';
      if ((severityRank[severity] ?? 0) < severityRank.moderate) continue;
      const id = via.url?.split('/').pop();
      const finding = `${moduleDir}: ${packageName} (${severity}) ${id} — ${via.title}`;
      if (omitDev) {
        failures.push(`PRODUCTION ${finding}`);
      } else if (allowedDevelopmentAdvisories.has(id)) {
        exceptions.push(finding);
      } else {
        failures.push(finding);
      }
    }
  }

  const counts = report.metadata?.vulnerabilities || {};
  console.log(`${moduleDir}${omitDev ? ' (production)' : ''}: ${JSON.stringify(counts)}`);
}

try {
  for (const moduleDir of modules) audit(moduleDir, true);
  for (const moduleDir of modules) audit(moduleDir, false);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

for (const finding of exceptions) console.log(`ALLOWED DEVELOPMENT EXCEPTION: ${finding}`);
for (const finding of failures) console.error(`BLOCKED: ${finding}`);
console.log(`Dependency audit: ${exceptions.length} documented development exceptions, ${failures.length} blocked findings.`);
if (failures.length > 0) process.exit(1);
