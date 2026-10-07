import {
  MobileBoostClient,
  TriggerAutotestRunOptions,
  TriggerRunOptions,
} from '../lib/client';
import { logger } from '../lib/logger';
import { TriggerResult } from '../lib/types';
import { skippedWarnings } from './skipped';

/**
 * Triggers a GPT-Driver suite run and returns the result. The backend creates
 * one suite per `iterations`; this action tracks only the first (we warn when
 * there are more, so iterations>1 results aren't silently dropped).
 */
export async function triggerRun(
  client: MobileBoostClient,
  opts: TriggerRunOptions,
): Promise<TriggerResult> {
  const result = await client.triggerRun(opts);
  logger.info(`Triggered run ${result.runId} (status: ${result.status})`);

  warnAboutSkipped(result);

  if (result.allRunIds.length > 1) {
    logger.warning(
      `Trigger created ${result.allRunIds.length} runs (iterations > 1); ` +
        `this action tracks only the first: ${result.runId}. ` +
        `All run ids: ${result.allRunIds.join(', ')}`,
    );
  }
  return result;
}

/**
 * Triggers an autotest run (pytest files from the org's test repo, executed on
 * real devices). Always one run — the endpoint has no `iterations`, so there is
 * nothing to warn about here.
 */
export async function triggerAutotestRun(
  client: MobileBoostClient,
  opts: TriggerAutotestRunOptions,
): Promise<TriggerResult> {
  const result = await client.triggerAutotestRun(opts);
  logger.info(
    `Triggered autotest run ${result.runId} (status: ${result.status})`,
  );
  warnAboutSkipped(result);
  return result;
}

/**
 * Annotates the workflow when the run leaves out tests the selection matched.
 * A warning, not a failure: the tests that are ready still run, and the ones
 * that are not are reported, so a tag can be used while its tests are still
 * being automated.
 */
function warnAboutSkipped(result: TriggerResult): void {
  for (const warning of skippedWarnings(result)) logger.warning(warning);
}
