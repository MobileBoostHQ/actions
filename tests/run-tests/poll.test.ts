import { ApiError, TimeoutError } from '../../src/lib/errors';
import { MobileBoostClient } from '../../src/lib/client';
import { RunStatus, TestResult } from '../../src/lib/types';
import {
  isCancelled,
  isPassing,
  isTerminal,
  pollRun,
} from '../../src/run-tests/poll';

function status(partial: Partial<RunStatus>): RunStatus {
  return {
    runId: 'r',
    status: 'running',
    totalTests: 0,
    succeededTests: [],
    failedTests: [],
    blockedTests: [],
    ...partial,
  };
}

const test = (id: string): TestResult => ({
  id,
  title: id,
  status: 'x',
  recording: '',
});

const noSleep = (): Promise<void> => Promise.resolve();

describe('status classification', () => {
  it('isTerminal covers completed and cancelled', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('queued')).toBe(false);
  });

  it('isCancelled detects cancelled', () => {
    expect(isCancelled(status({ status: 'cancelled' }))).toBe(true);
    expect(isCancelled(status({ status: 'completed' }))).toBe(false);
  });

  it('isPassing requires no failures or blocks and not cancelled', () => {
    expect(isPassing(status({ status: 'completed' }))).toBe(true);
    expect(
      isPassing(status({ status: 'completed', failedTests: [test('a')] })),
    ).toBe(false);
    expect(
      isPassing(status({ status: 'completed', blockedTests: [test('a')] })),
    ).toBe(false);
    expect(isPassing(status({ status: 'cancelled' }))).toBe(false);
  });
});

describe('pollRun', () => {
  it('returns once the run reaches a terminal status', async () => {
    const sequence = [
      status({ status: 'running' }),
      status({ status: 'running' }),
      status({ status: 'completed', succeededTests: [test('a')] }),
    ];
    let i = 0;
    const getRunStatus = jest.fn(() => Promise.resolve(sequence[i++]));
    const client = { getRunStatus } as unknown as MobileBoostClient;

    const final = await pollRun(client, 'r', {
      timeoutMs: 1_000_000,
      dashboardUrl: 'http://dash',
      sleepFn: noSleep,
    });
    expect(final.status).toBe('completed');
    expect(getRunStatus).toHaveBeenCalledTimes(3);
  });

  it('treats cancelled as terminal', async () => {
    const getRunStatus = jest.fn(() =>
      Promise.resolve(status({ status: 'cancelled' })),
    );
    const client = { getRunStatus } as unknown as MobileBoostClient;

    const final = await pollRun(client, 'r', {
      timeoutMs: 1_000_000,
      dashboardUrl: 'http://dash',
      sleepFn: noSleep,
    });
    expect(final.status).toBe('cancelled');
    expect(getRunStatus).toHaveBeenCalledTimes(1);
  });

  it('throws TimeoutError when the budget is exceeded', async () => {
    let clock = 0;
    const client = {
      getRunStatus: jest.fn(() => Promise.resolve(status({ status: 'running' }))),
    } as unknown as MobileBoostClient;

    await expect(
      pollRun(client, 'r', {
        timeoutMs: 500,
        dashboardUrl: 'http://dash',
        sleepFn: noSleep,
        nowFn: () => (clock += 1000), // jumps past the budget on first check
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('tolerates early 404s while the suite is still initializing', async () => {
    // 404 three times (suite not written yet), then it appears and completes.
    let clock = 0;
    let calls = 0;
    const getRunStatus = jest.fn(() => {
      calls++;
      if (calls <= 3) {
        return Promise.reject(
          new ApiError(404, 'Not found (404): Suite x not found'),
        );
      }
      return Promise.resolve(
        status({ status: 'completed', succeededTests: [test('a')] }),
      );
    });
    const client = { getRunStatus } as unknown as MobileBoostClient;

    const final = await pollRun(client, 'r', {
      timeoutMs: 1_000_000,
      dashboardUrl: 'http://dash',
      sleepFn: noSleep,
      nowFn: () => (clock += 1000), // 1s per check — well within the grace window
    });
    expect(final.status).toBe('completed');
    expect(getRunStatus).toHaveBeenCalledTimes(4);
  });

  it('gives up on a 404 once the grace window has elapsed', async () => {
    // Each check jumps the clock forward 60s, so by the time the failure
    // budget is spent we are well past the 120s grace window.
    let clock = 0;
    const getRunStatus = jest.fn(() =>
      Promise.reject(new ApiError(404, 'Not found (404): Suite x not found')),
    );
    const client = { getRunStatus } as unknown as MobileBoostClient;

    await expect(
      pollRun(client, 'r', {
        timeoutMs: 1_000_000,
        dashboardUrl: 'http://dash',
        sleepFn: noSleep,
        nowFn: () => (clock += 60_000),
      }),
    ).rejects.toThrow('Suite x not found');
  });

  it('tolerates up to 3 consecutive failures, then gives up', async () => {
    const getRunStatus = jest.fn(() => Promise.reject(new Error('network')));
    const client = { getRunStatus } as unknown as MobileBoostClient;

    await expect(
      pollRun(client, 'r', {
        timeoutMs: 1_000_000,
        dashboardUrl: 'http://dash',
        sleepFn: noSleep,
      }),
    ).rejects.toThrow('network');
    // 3 tolerated + 1 that gives up
    expect(getRunStatus).toHaveBeenCalledTimes(4);
  });
});
