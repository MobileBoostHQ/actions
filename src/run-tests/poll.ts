import { MobileBoostClient } from '../lib/client';
import { ApiError, TimeoutError } from '../lib/errors';
import { logger } from '../lib/logger';
import { RunStatus } from '../lib/types';

// A suite reaches exactly one of these and then never changes. `cancelled`
// matters: a cancelled suite never becomes `completed`, so without it here a
// sync poll would spin until the overall timeout.
export const TERMINAL_STATUSES = ['completed', 'cancelled'];

const BASE_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

// The backend hands back a run id synchronously but writes the run document
// asynchronously (for suites, the background-test server only creates it after
// the build upload is confirmed processed; for autotests, the orchestrator
// writes it from a background task). Until that write lands the status endpoint
// returns a 404 — a transient "not registered yet", not a real failure. We
// tolerate early 404s for this long before counting them against the failure
// budget. Sized to the background-test server's worst-case upload-processing
// wait (8 retries x 30s) before it writes the suite document.
const SUITE_CREATION_GRACE_MS = 240_000;

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status.toLowerCase());
}

export function isCancelled(run: RunStatus): boolean {
  return run.status.toLowerCase() === 'cancelled';
}

/** A completed run passes iff nothing failed or was blocked. */
export function isPassing(run: RunStatus): boolean {
  return (
    !isCancelled(run) &&
    run.failedTests.length === 0 &&
    run.blockedTests.length === 0
  );
}

export interface PollOptions {
  timeoutMs: number;
  dashboardUrl: string;
  /**
   * Which status endpoint to poll. Autotest runs live in a different collection
   * to suite runs and answer on a different path; the response shape is the
   * same, so only the fetch differs. Defaults to the suite endpoint.
   */
  mode?: 'gpt-driver' | 'ai-sdet';
  // Injection points for deterministic tests.
  intervalBaseMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

/** Polls until the run reaches a terminal status, or throws on timeout. */
export async function pollRun(
  client: MobileBoostClient,
  runId: string,
  options: PollOptions,
): Promise<RunStatus> {
  const sleep = options.sleepFn ?? defaultSleep;
  const now = options.nowFn ?? Date.now;
  const start = now();
  let interval = options.intervalBaseMs ?? BASE_INTERVAL_MS;
  let consecutiveFailures = 0;
  const getStatus = (id: string): Promise<RunStatus> =>
    options.mode === 'ai-sdet'
      ? client.getAutotestRunStatus(id)
      : client.getRunStatus(id);

  for (;;) {
    if (now() - start > options.timeoutMs) {
      throw new TimeoutError(
        `Run ${runId} did not finish within the timeout. It is still running ` +
          `on MobileBoost — see ${options.dashboardUrl}`,
      );
    }

    try {
      const status = await getStatus(runId);
      consecutiveFailures = 0;
      logProgress(status);
      if (isTerminal(status.status)) return status;
    } catch (err) {
      // A 404 within the grace window means the suite document hasn't been
      // written yet, not that the run is gone — keep polling without spending
      // the failure budget. After the window, a 404 is a real "not found".
      const isEarly404 =
        err instanceof ApiError &&
        err.statusCode === 404 &&
        now() - start <= SUITE_CREATION_GRACE_MS;
      if (isEarly404) {
        logger.info(
          `Run ${runId} not registered yet (suite still initializing), will keep polling…`,
        );
      } else {
        consecutiveFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          throw err;
        }
        logger.warning(
          `Status check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), ` +
            `will retry: ${msg}`,
        );
      }
    }

    await sleep(jitter(interval));
    interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * 1.5));
  }
}

function logProgress(s: RunStatus): void {
  const passed = s.succeededTests.length;
  const failed = s.failedTests.length;
  const blocked = s.blockedTests.length;
  const done = passed + failed + blocked;
  const total = s.totalTests || done;
  logger.info(
    `Run ${s.runId}: ${s.status} — ${done}/${total} tests done ` +
      `(${passed} passed, ${failed} failed, ${blocked} blocked)`,
  );
}

function jitter(ms: number): number {
  const delta = ms * 0.2; // ±20%
  return Math.round(ms - delta + Math.random() * 2 * delta);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
