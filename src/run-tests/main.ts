import * as core from '@actions/core';
import { createClient } from '../lib/client';
import { InvalidInputError, MobileBoostError } from '../lib/errors';
import { logger } from '../lib/logger';
import {
  parseBoolean,
  parseCsv,
  parseInteger,
  parseJsonArray,
  parseJsonObject,
} from '../lib/validate';
import { isCancelled } from './poll';
import { pollRun } from './poll';
import { triggerAutotestRun, triggerRun } from './trigger';
import { buildRunUrl, RunMode, writeRunSummary } from './summary';

const RUN_MODES: RunMode[] = ['gpt-driver', 'autotest'];

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const organisationId = core.getInput('organisation-id', { required: true });
    const buildId = core.getInput('build-id', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://api.mobileboost.io';
    const mode = parseMode(core.getInput('mode'));

    // Test selection — at least one selector required.
    const testIds = parseCsv(core.getInput('test-ids'));
    const tags = parseCsv(core.getInput('tags'));
    const tagsQuery = core.getInput('tags-query').trim();
    if (testIds.length === 0 && tags.length === 0 && !tagsQuery) {
      throw new InvalidInputError(
        'Provide at least one of `test-ids`, `tags`, or `tags-query`.',
      );
    }
    // Fail loudly instead of silently dropping a selector the autotest endpoint
    // has no equivalent for — a job that quietly ran the wrong tests is worse
    // than one that didn't start.
    if (mode === 'autotest' && tagsQuery) {
      throw new InvalidInputError(
        '`tags-query` is not supported when `mode: autotest` — use `test-ids` or `tags`.',
      );
    }

    // Run configuration (all optional).
    const iterations = optionalInt('iterations');
    const launchParams = optionalJsonObject('launch-params');
    const deviceProviderSettings = optionalJsonObject(
      'device-provider-settings',
    );
    const testInputs = optionalJsonObject('test-inputs');
    const metadata = optionalJsonObject('metadata');
    const deviceConfigs = optionalJsonArray('device-configs');

    // Action behavior.
    const asyncMode = parseBoolean('async', core.getInput('async') || 'true');
    const timeoutMinutes = parseInteger(
      'timeout-minutes',
      core.getInput('timeout-minutes') || '180',
    );
    const failOnTestFailure = parseBoolean(
      'fail-on-test-failure',
      core.getInput('fail-on-test-failure') || 'true',
    );

    // The autotest endpoint takes none of these. Say so rather than dropping
    // them silently — a run configured with launch params that never reached
    // the device looks like a product bug from the outside.
    if (mode === 'autotest') {
      const ignored = (
        [
          ['iterations', iterations],
          ['launch-params', launchParams],
          ['device-provider-settings', deviceProviderSettings],
          ['test-inputs', testInputs],
          ['device-configs', deviceConfigs],
          ['metadata', metadata],
        ] as const
      )
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name);
      if (ignored.length > 0) {
        logger.warning(
          `mode: autotest ignores these inputs: ${ignored.join(', ')}.`,
        );
      }
    }

    const client = createClient(apiKey, apiUrl);

    const trigger =
      mode === 'autotest'
        ? await triggerAutotestRun(client, {
            organisationId,
            buildId,
            testIds,
            tags,
            testsRepo: core.getInput('tests-repo') || undefined,
            usePhysicalDevice: optionalBoolean('use-physical-device'),
          })
        : await triggerRun(client, {
            organisationId,
            buildId,
            testIds,
            tags,
            tagsQuery: tagsQuery || undefined,
            iterations,
            launchParams,
            deviceProviderSettings,
            testInputs,
            deviceConfigs,
            metadata,
          });
    core.setOutput('run-id', trigger.runId);

    const runUrl = buildRunUrl(trigger.runId, mode);

    if (asyncMode) {
      logger.info('async=true — returning immediately after triggering.');
      await writeAsyncSummary(trigger.runId, trigger.status, runUrl);
      return;
    }

    const startedAt = Date.now();
    const final = await pollRun(client, trigger.runId, {
      timeoutMs: timeoutMinutes * 60_000,
      dashboardUrl: runUrl,
      mode,
    });
    const durationMs = Date.now() - startedAt;

    const passed = final.succeededTests.length;
    const failed = final.failedTests.length;
    const blocked = final.blockedTests.length;
    core.setOutput('passed', String(passed));
    core.setOutput('failed', String(failed));
    core.setOutput('blocked', String(blocked));

    const cancelled = isCancelled(final);
    await writeRunSummary(final, { durationMs, runUrl, cancelled });

    if (cancelled) {
      core.setFailed(`Run was cancelled. See ${runUrl}`);
      return;
    }
    if (failOnTestFailure && failed + blocked > 0) {
      core.setFailed(
        `${failed} failed, ${blocked} blocked. See dashboard: ${runUrl}`,
      );
      return;
    }
    logger.info(
      `Run passed — ${passed} passed, ${failed} failed, ${blocked} blocked.`,
    );
  } catch (err) {
    if (err instanceof MobileBoostError) {
      core.setFailed(err.message);
    } else if (err instanceof Error) {
      logger.debug(err.stack ?? err.message);
      core.setFailed(err.message);
    } else {
      core.setFailed(`Unexpected error: ${String(err)}`);
    }
  }
}

function parseMode(raw: string): RunMode {
  const value = (raw || 'gpt-driver').trim().toLowerCase();
  if (!RUN_MODES.includes(value as RunMode)) {
    throw new InvalidInputError(
      `Invalid \`mode\`: "${raw}". Expected one of: ${RUN_MODES.join(', ')}.`,
    );
  }
  return value as RunMode;
}

function optionalInt(name: string): number | undefined {
  const raw = core.getInput(name);
  return raw ? parseInteger(name, raw) : undefined;
}

function optionalBoolean(name: string): boolean | undefined {
  const raw = core.getInput(name);
  return raw ? parseBoolean(name, raw) : undefined;
}

function optionalJsonObject(name: string): Record<string, unknown> | undefined {
  const raw = core.getInput(name);
  return raw ? parseJsonObject(name, raw) : undefined;
}

function optionalJsonArray(name: string): unknown[] | undefined {
  const raw = core.getInput(name);
  return raw ? parseJsonArray(name, raw) : undefined;
}

async function writeAsyncSummary(
  runId: string,
  status: string,
  runUrl: string,
): Promise<void> {
  await core.summary
    .addHeading('MobileBoost — Test Run Triggered', 2)
    .addRaw(`Run \`${runId}\` triggered (status: ${status}).`, true)
    .addEOL()
    .addRaw('Running asynchronously — not waiting for completion.', true)
    .addEOL()
    .addLink('Open run in dashboard', runUrl)
    .write();
}

void run();
