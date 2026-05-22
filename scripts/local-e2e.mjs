#!/usr/bin/env node
// Local end-to-end harness: runs the committed action bundles against a real
// MobileBoost API, exactly as a GitHub runner would (inputs via INPUT_* env,
// outputs via GITHUB_OUTPUT, summary via GITHUB_STEP_SUMMARY).
//
//   1. cp .env.local.example .env.local  (and fill it in)
//   2. npm run e2e:local
//
// The API key is loaded from .env.local and never printed.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_KEYS = new Set(['MOBILEBOOST_API_KEY']);

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function loadEnvFile() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) {
    fail(
      'Missing .env.local. Copy .env.local.example to .env.local and fill it in.',
    );
  }
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const left = value.trimStart();
    if (left.startsWith('"') || left.startsWith("'")) {
      // Quoted: take the quoted content verbatim (may contain '#').
      const quote = left[0];
      const end = left.indexOf(quote, 1);
      value = end > 0 ? left.slice(1, end) : left.slice(1);
    } else {
      // Unquoted: strip an inline comment (' #...') then a whole-value comment.
      value = value.replace(/\s+#.*$/, '').trim();
      if (value.startsWith('#')) value = '';
    }
    if (value) env[key] = value;
  }
  return env;
}

// core.getInput maps `name` to env `INPUT_<NAME>` (spaces -> _, uppercased,
// dashes preserved). Mirror that here.
function inputEnvName(name) {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

// Parse a GITHUB_OUTPUT file written by @actions/core (heredoc blocks plus the
// occasional key=value line).
function parseOutputs(content) {
  const outputs = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const heredoc = line.match(/^(.+?)<<(.+)$/);
    if (heredoc) {
      const [, key, delim] = heredoc;
      i++;
      const valueLines = [];
      while (i < lines.length && lines[i] !== delim) valueLines.push(lines[i++]);
      outputs[key] = valueLines.join('\n');
      i++; // skip closing delimiter
    } else if (line.includes('=')) {
      const idx = line.indexOf('=');
      outputs[line.slice(0, idx)] = line.slice(idx + 1);
      i++;
    } else {
      i++;
    }
  }
  return outputs;
}

function runAction(label, actionDir, inputs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-e2e-'));
  const outputFile = path.join(tmp, 'output.txt');
  const summaryFile = path.join(tmp, 'summary.md');
  fs.writeFileSync(outputFile, '');
  fs.writeFileSync(summaryFile, '');

  const childEnv = {
    ...process.env,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
  };
  for (const [name, value] of Object.entries(inputs)) {
    if (value !== undefined && value !== '') {
      childEnv[inputEnvName(name)] = String(value);
    }
  }

  console.log(`\n=== ${label} ===`);
  const result = spawnSync(
    process.execPath,
    [path.join(actionDir, 'dist', 'index.js')],
    { env: childEnv, stdio: 'inherit' },
  );

  const outputs = parseOutputs(fs.readFileSync(outputFile, 'utf8'));
  const summary = fs.readFileSync(summaryFile, 'utf8');
  return { status: result.status ?? 1, outputs, summary };
}

// Config keys the harness understands. Values come from .env.local but can be
// overridden by a matching process env var (handy for one-off runs, e.g.
// MODE=run BUILD_ID=... npm run e2e:local).
const CONFIG_KEYS = [
  'MOBILEBOOST_API_KEY',
  'MOBILEBOOST_ORG_ID',
  'BUILD_PATH',
  'METADATA',
  'TAGS',
  'TEST_IDS',
  'TAGS_QUERY',
  'ITERATIONS',
  'ASYNC',
  'TIMEOUT_MINUTES',
  'FAIL_ON_TEST_FAILURE',
  'API_URL',
  'MODE',
  'BUILD_ID',
];

function main() {
  const env = loadEnvFile();
  for (const k of CONFIG_KEYS) {
    if (process.env[k] !== undefined && process.env[k] !== '') {
      env[k] = process.env[k];
    }
  }
  const apiKey = env.MOBILEBOOST_API_KEY;
  const orgId = env.MOBILEBOOST_ORG_ID;
  if (!apiKey) fail('MOBILEBOOST_API_KEY is not set in .env.local');
  if (!orgId) fail('MOBILEBOOST_ORG_ID is not set in .env.local');

  const apiUrl = env.API_URL || 'https://api.mobileboost.io';
  const mode = (env.MODE || 'both').toLowerCase();
  const hasSelector = !!(env.TAGS || env.TEST_IDS || env.TAGS_QUERY);

  console.log('MobileBoost local e2e');
  console.log(`  api-url : ${apiUrl}`);
  console.log(`  org     : ${orgId}`);
  console.log(`  api-key : (loaded from .env.local, hidden)`);
  console.log(`  mode    : ${mode}`);
  // Belt-and-braces: keep the key out of any child output stream.
  for (const k of SECRET_KEYS) process.env[k] = env[k] ?? process.env[k];

  let buildId = env.BUILD_ID;

  // --- upload ---
  if (mode === 'both' || mode === 'upload') {
    if (!env.BUILD_PATH) fail('BUILD_PATH is required to upload a build.');
    const up = runAction('upload-build', path.join(ROOT, 'upload-build'), {
      'api-key': apiKey,
      'organisation-id': orgId,
      'build-path': env.BUILD_PATH,
      metadata: env.METADATA,
      'api-url': apiUrl,
    });
    if (up.status !== 0) fail(`upload-build failed (exit ${up.status}).`);
    buildId = up.outputs['build-id'];
    console.log(`\n→ build-id : ${buildId}`);
    console.log(`→ app-link : ${up.outputs['app-link']}`);
    if (mode === 'upload') return;
  }

  // --- run ---
  if (mode === 'both' || mode === 'run') {
    if (!buildId) fail('No build-id available (set BUILD_ID for MODE=run).');
    if (!hasSelector) fail('Set TAGS, TEST_IDS, or TAGS_QUERY to run tests.');
    const run = runAction('run-tests', path.join(ROOT, 'run-tests'), {
      'api-key': apiKey,
      'organisation-id': orgId,
      'build-id': buildId,
      tags: env.TAGS,
      'test-ids': env.TEST_IDS,
      'tags-query': env.TAGS_QUERY,
      iterations: env.ITERATIONS,
      async: env.ASYNC,
      'timeout-minutes': env.TIMEOUT_MINUTES,
      'fail-on-test-failure': env.FAIL_ON_TEST_FAILURE,
      'api-url': apiUrl,
    });
    console.log(`\n→ run-id   : ${run.outputs['run-id']}`);
    console.log(
      `→ results  : ${run.outputs['passed'] ?? '-'} passed, ` +
        `${run.outputs['failed'] ?? '-'} failed, ` +
        `${run.outputs['blocked'] ?? '-'} blocked`,
    );
    if (run.summary.trim()) {
      console.log('\n--- step summary ---\n' + run.summary);
    }
    process.exit(run.status);
  }
}

main();
