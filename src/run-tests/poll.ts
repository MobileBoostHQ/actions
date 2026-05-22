import { MobileBoostClient } from '../lib/client';
import { TimeoutError } from '../lib/errors';
import { logger } from '../lib/logger';
import { RunStatus } from '../lib/types';

// A suite reaches exactly one of these and then never changes. `cancelled`
// matters: a cancelled suite never becomes `completed`, so without it here a
// sync poll would spin until the overall timeout.
export const TERMINAL_STATUSES = ['completed', 'cancelled'];

const BASE_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

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

  for (;;) {
    if (now() - start > options.timeoutMs) {
      throw new TimeoutError(
        `Run ${runId} did not finish within the timeout. It is still running ` +
          `on MobileBoost — see ${options.dashboardUrl}`,
      );
    }

    try {
      const status = await client.getRunStatus(runId);
      consecutiveFailures = 0;
      logProgress(status);
      if (isTerminal(status.status)) return status;
    } catch (err) {
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
