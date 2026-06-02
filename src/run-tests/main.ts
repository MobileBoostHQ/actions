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
import { triggerRun } from './trigger';
import { buildRunUrl, writeRunSummary } from './summary';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const organisationId = core.getInput('organisation-id', { required: true });
    const buildId = core.getInput('build-id', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://api.mobileboost.io';

    // Test selection — at least one selector required.
    const testIds = parseCsv(core.getInput('test-ids'));
    const tags = parseCsv(core.getInput('tags'));
    const tagsQuery = core.getInput('tags-query').trim();
    if (testIds.length === 0 && tags.length === 0 && !tagsQuery) {
      throw new InvalidInputError(
        'Provide at least one of `test-ids`, `tags`, or `tags-query`.',
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

    const client = createClient(apiKey, apiUrl);

    const trigger = await triggerRun(client, {
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

    const runUrl = buildRunUrl(trigger.runId);

    if (asyncMode) {
      logger.info('async=true — returning immediately after triggering.');
      await writeAsyncSummary(trigger.runId, trigger.status, runUrl);
      return;
    }

    const startedAt = Date.now();
    const final = await pollRun(client, trigger.runId, {
      timeoutMs: timeoutMinutes * 60_000,
      dashboardUrl: runUrl,
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

function optionalInt(name: string): number | undefined {
  const raw = core.getInput(name);
  return raw ? parseInteger(name, raw) : undefined;
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
