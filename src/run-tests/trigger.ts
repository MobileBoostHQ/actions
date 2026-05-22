import { MobileBoostClient, TriggerRunOptions } from '../lib/client';
import { logger } from '../lib/logger';
import { TriggerResult } from '../lib/types';

/**
 * Triggers a run and returns the result. The backend creates one suite per
 * `iterations`; this action tracks only the first (we warn when there are
 * more, so iterations>1 results aren't silently dropped).
 */
export async function triggerRun(
  client: MobileBoostClient,
  opts: TriggerRunOptions,
): Promise<TriggerResult> {
  const result = await client.triggerRun(opts);
  logger.info(`Triggered run ${result.runId} (status: ${result.status})`);

  if (result.allRunIds.length > 1) {
    logger.warning(
      `Trigger created ${result.allRunIds.length} runs (iterations > 1); ` +
        `this action tracks only the first: ${result.runId}. ` +
        `All run ids: ${result.allRunIds.join(', ')}`,
    );
  }
  return result;
}
