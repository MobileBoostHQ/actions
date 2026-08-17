import {
  defaultTunnelName,
  releaseTarget,
} from '../../src/setup-local-tunnel/tunnel';
import { InvalidInputError } from '../../src/lib/errors';

describe('defaultTunnelName', () => {
  it('is unique per job, not per run', () => {
    // A matrix expands one run id into several jobs. Naming by run alone would
    // have them all claim the same tunnel, and the control plane refuses the
    // second with "already connected" — a failure that looks like a flaky test.
    const base = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    const a = defaultTunnelName({
      ...base,
      GITHUB_JOB: 'test-ios',
    } as NodeJS.ProcessEnv);
    const b = defaultTunnelName({
      ...base,
      GITHUB_JOB: 'test-android',
    } as NodeJS.ProcessEnv);

    expect(a).not.toEqual(b);
  });

  it('distinguishes a re-run from the attempt it replaces', () => {
    // The previous attempt may still be draining when the re-run starts.
    const base = { GITHUB_RUN_ID: '123', GITHUB_JOB: 'test' };
    const first = defaultTunnelName({
      ...base,
      GITHUB_RUN_ATTEMPT: '1',
    } as NodeJS.ProcessEnv);
    const second = defaultTunnelName({
      ...base,
      GITHUB_RUN_ATTEMPT: '2',
    } as NodeJS.ProcessEnv);

    expect(first).not.toEqual(second);
  });

  it('produces a name the control plane will accept', () => {
    const name = defaultTunnelName({
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'Build & Test (iOS, 17.0)',
    } as NodeJS.ProcessEnv);

    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name).not.toMatch(/^-|-$/);
    expect(name).not.toMatch(/--/);
    expect(name.length).toBeLessThanOrEqual(60);
  });

  it('stays valid when a long job name is truncated', () => {
    const name = defaultTunnelName({
      GITHUB_RUN_ID: '1234567890',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'a-very-long-job-name-'.repeat(10),
    } as NodeJS.ProcessEnv);

    expect(name.length).toBeLessThanOrEqual(60);
    // Truncation must not leave a trailing dash.
    expect(name).not.toMatch(/-$/);
  });

  it('falls back outside GitHub Actions', () => {
    expect(defaultTunnelName({} as NodeJS.ProcessEnv)).toBe('gh-local-1-job');
  });
});

describe('releaseTarget', () => {
  it.each([
    ['linux', 'x64', 'linux-amd64'],
    ['linux', 'arm64', 'linux-arm64'],
    ['darwin', 'arm64', 'darwin-arm64'],
    ['darwin', 'x64', 'darwin-amd64'],
    ['win32', 'x64', 'windows-amd64.exe'],
  ])('maps %s/%s to %s', (platform, arch, expected) => {
    expect(releaseTarget(platform, arch)).toBe(expected);
  });

  it('names the runner it cannot serve rather than guessing', () => {
    // Guessing here downloads a binary that cannot execute, and the job fails
    // much later with "cannot execute binary file".
    expect(() => releaseTarget('linux', 'ppc64')).toThrow(InvalidInputError);
    expect(() => releaseTarget('aix', 'x64')).toThrow(/Unsupported runner/);
  });
});
