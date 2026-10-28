import * as core from '@actions/core';
import { createClient } from '../lib/client';
import { InvalidInputError, MobileBoostError } from '../lib/errors';
import { logger } from '../lib/logger';
import { SkippedTest } from '../lib/types';
import {
  parseBoolean,
  parseCsv,
  parseInteger,
  parseJsonArray,
  parseJsonObject,
} from '../lib/validate';
import { parseMode } from './mode';
import { isCancelled, needsReview, reviewCount } from './poll';
import { pollRun } from './poll';
import { triggerAutotestRun, triggerRun } from './trigger';
import {
  buildRunUrl,
  buildSkippedRows,
  needsReviewAnnotation,
  NEEDS_REVIEW_ANNOTATION_TITLE,
  writeRunSummary,
} from './summary';
import { resolveSkipped } from './skipped';
import { parseAppTarget } from './target';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const organisationId = core.getInput('organisation-id', { required: true });
    const app = parseAppTarget({
      buildId: core.getInput('build-id'),
      bundleId: core.getInput('bundle-id'),
      platform: core.getInput('platform'),
    });
    const apiUrl = core.getInput('api-url') || 'https://api.mobileboost.io';
    const { mode, aliasUsed } = parseMode(core.getInput('mode'));
    if (aliasUsed) {
      logger.info(
        `\`mode: ${aliasUsed}\` is now called \`${mode}\`; both work.`,
      );
    }

    // Test selection — at least one selector required.
    const testIds = parseCsv(core.getInput('test-ids'));
    const tags = parseCsv(core.getInput('tags'));
    const tagsQuery = core.getInput('tags-query').trim();
    if (testIds.length === 0 && tags.length === 0 && !tagsQuery) {
      throw new InvalidInputError(
        'Provide at least one of `test-ids`, `tags`, or `tags-query`.',
      );
    }
    // Fail loudly instead of silently dropping a selector the AI SDET endpoint
    // has no equivalent for — a job that quietly ran the wrong tests is worse
    // than one that didn't start.
    // Refused rather than dropped. The gpt-driver path runs on a third-party
    // device cloud, so there is no host of ours for a tunnel to terminate on
    // and the API rejects the field anyway. Silently ignoring it would leave
    // the app reaching the public internet while the workflow says otherwise,
    // and every request to an internal host would time out with nothing
    // pointing at the cause.
    const tunnelName = core.getInput('tunnel-name').trim();
    if (tunnelName && mode !== 'ai-sdet') {
      throw new InvalidInputError(
        '`tunnel-name` requires `mode: ai-sdet`. MobileBoost Local tunnels are ' +
          'available on the AI SDET path, which runs on MobileBoost devices; the ' +
          'gpt-driver path runs on a third-party device cloud that a tunnel cannot reach.',
      );
    }

    if (mode === 'ai-sdet' && tagsQuery) {
      throw new InvalidInputError(
        '`tags-query` is not supported when `mode: ai-sdet` — use `test-ids` or `tags`.',
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
    // A test that needs review is a question for a person (the healing agent
    // could not tell a broken test from an intended app change), so by
    // default it warns rather than failing the job.
    const failOnNeedsReview = parseBoolean(
      'fail-on-needs-review',
      core.getInput('fail-on-needs-review') || 'false',
    );

    // The autotest endpoint takes none of these. Say so rather than dropping
    // them silently — a run configured with launch params that never reached
    // the device looks like a product bug from the outside.
    if (mode === 'ai-sdet') {
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

    // Refused rather than overridden. Only physical devices carry a
    // pre-installed app, so the API sends a bundle-id run to one whatever this
    // says; a workflow asking for a simulator would get a handset without
    // being told.
    const usePhysicalDevice = optionalBoolean('use-physical-device');
    if ('bundleId' in app && usePhysicalDevice === false) {
      throw new InvalidInputError(
        '`bundle-id` runs on a physical device, the only kind with your app ' +
          'pre-installed. Remove `use-physical-device: false`, or upload a ' +
          'build to run on a simulator or emulator.',
      );
    }

    const client = createClient(apiKey, apiUrl);

    const trigger =
      mode === 'ai-sdet'
        ? await triggerAutotestRun(client, {
            ...app,
            organisationId,
            testIds,
            tags,
            testsRepo: core.getInput('tests-repo') || undefined,
            usePhysicalDevice,
            tunnelName: tunnelName || undefined,
          })
        : await triggerRun(client, {
            ...app,
            organisationId,
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
    // Known at trigger time, so set in async mode too.
    core.setOutput('not-scheduled', String(trigger.skippedTests.length));

    const runUrl = buildRunUrl(trigger.runId, trigger.backend);

    if (asyncMode) {
      logger.info('async=true — returning immediately after triggering.');
      await writeAsyncSummary(
        trigger.runId,
        trigger.status,
        runUrl,
        trigger.skippedTests,
      );
      return;
    }

    const startedAt = Date.now();
    const final = await pollRun(client, trigger.runId, {
      timeoutMs: timeoutMinutes * 60_000,
      dashboardUrl: runUrl,
      mode,
    });
    const durationMs = Date.now() - startedAt;
    // Reported, never gated on: a test that was not scheduled was not tested.
    final.skippedTests = resolveSkipped(
      final.skippedTests,
      trigger.skippedTests,
    );
    core.setOutput('not-scheduled', String(final.skippedTests.length));

    const passed = final.succeededTests.length;
    const failed = final.failedTests.length;
    const blocked = final.blockedTests.length;
    const reviewTests = needsReview(final);
    const review = reviewTests.length;
    core.setOutput('passed', String(passed));
    core.setOutput('failed', String(failed));
    core.setOutput('blocked', String(blocked));
    core.setOutput('needs-review', String(review));

    // One annotation per test, so each shows on the workflow run page with a
    // link to its report, whether or not it fails the job.
    for (const test of reviewTests) {
      core.warning(needsReviewAnnotation(test), {
        title: NEEDS_REVIEW_ANNOTATION_TITLE,
      });
    }

    const cancelled = isCancelled(final);
    await writeRunSummary(final, {
      durationMs,
      runUrl,
      cancelled,
      failOnNeedsReview,
    });

    if (cancelled) {
      core.setFailed(`Run was cancelled. See ${runUrl}`);
      return;
    }
    const reviewPart = review > 0 ? `, ${reviewCount(review)}` : '';
    if (failOnTestFailure && failed + blocked > 0) {
      core.setFailed(
        `${failed} failed, ${blocked} blocked${reviewPart}. See dashboard: ${runUrl}`,
      );
      return;
    }
    if (failOnNeedsReview && review > 0) {
      core.setFailed(
        `${review} ${review === 1 ? 'test needs' : 'tests need'} review ` +
          `(fail-on-needs-review is on). See dashboard: ${runUrl}`,
      );
      return;
    }
    logger.info(
      `Run passed — ${passed} passed, ${failed} failed, ${blocked} blocked${reviewPart}.`,
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
  skipped: SkippedTest[],
): Promise<void> {
  let summary = core.summary
    .addHeading('MobileBoost — Test Run Triggered', 2)
    .addRaw(`Run \`${runId}\` triggered (status: ${status}).`, true)
    .addEOL()
    .addRaw('Running asynchronously — not waiting for completion.', true)
    .addEOL()
    .addLink('Open run in dashboard', runUrl)
    .addEOL();
  if (skipped.length > 0) {
    summary = summary
      .addHeading(`Not scheduled (${skipped.length})`, 3)
      .addRaw(
        'These tests matched the selection but are not automated for this ' +
          'platform yet, so the run left them out.',
        true,
      )
      .addEOL()
      .addTable(buildSkippedRows(skipped));
  }
  await summary.write();
}

void run();
