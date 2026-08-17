import { execFile } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { get } from 'https';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { InvalidInputError, MobileBoostError } from '../lib/errors';
import { logger } from '../lib/logger';

const execFileAsync = promisify(execFile);

export const DOWNLOAD_BASE = 'https://get.mobileboost.io/mb-local';

/**
 * Where the binary and the tunnel name live between the main and post steps.
 *
 * Deliberately outside the workspace: `actions/checkout` can run after this
 * action and would wipe anything stored there, leaving the post step unable to
 * find either the binary or the name of the tunnel it has to stop.
 */
export function stateDir(): string {
  return join(process.env.RUNNER_TEMP || tmpdir(), 'mobileboost-local');
}

export function binaryPath(): string {
  return join(
    stateDir(),
    process.platform === 'win32' ? 'mb-local.exe' : 'mb-local',
  );
}

function nameFile(): string {
  return join(stateDir(), 'tunnel-name');
}

/** The release asset for this runner, e.g. `linux-amd64`. */
export function releaseTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const goarch: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };
  const goos: Record<string, string> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'windows',
  };
  if (!goarch[arch] || !goos[platform]) {
    throw new InvalidInputError(
      `Unsupported runner ${platform}/${arch}. mb-local ships linux, darwin and ` +
        `windows binaries for amd64 and arm64.`,
    );
  }
  const base = `${goos[platform]}-${goarch[arch]}`;
  return goos[platform] === 'windows' ? `${base}.exe` : base;
}

/**
 * A tunnel name unique to this job.
 *
 * Per job rather than per run: a matrix expands one run id into several jobs,
 * and they would all claim the same name and collide, which the control plane
 * refuses with "already connected". The attempt number keeps a re-run from
 * colliding with the attempt it replaces, which may still be draining.
 */
export function defaultTunnelName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = [
    'gh',
    env.GITHUB_RUN_ID || 'local',
    env.GITHUB_RUN_ATTEMPT || '1',
    env.GITHUB_JOB || 'job',
  ].join('-');

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Long names are unwieldy in logs and in the run payload. The run id and
  // attempt alone are unique, so truncating the job suffix stays safe.
  return cleaned.length > 60
    ? cleaned.slice(0, 60).replace(/-+$/, '')
    : cleaned;
}

async function download(
  url: string,
  dest: string,
  redirects = 0,
): Promise<void> {
  if (redirects > 5) {
    throw new MobileBoostError(`Too many redirects fetching ${url}`);
  }
  await new Promise<void>((resolve, reject) => {
    get(url, (res) => {
      // get.mobileboost.io redirects to the storage bucket. Without following
      // it the redirect body lands on disk and the step fails later with
      // "cannot execute binary file", which points nowhere useful.
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        download(res.headers.location, dest, redirects + 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new MobileBoostError(`GET ${url} returned HTTP ${status}`));
        return;
      }
      const out = createWriteStream(dest, { mode: 0o755 });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

/** Download mb-local unless a previous step or job already did. */
export async function installBinary(version: string): Promise<string> {
  await mkdir(stateDir(), { recursive: true });
  const bin = binaryPath();

  // Reused across steps, and across jobs on a long-lived self-hosted runner —
  // which is where this action is meant to run.
  if (existsSync(bin)) {
    logger.info(`mb-local already present at ${bin}`);
    return bin;
  }

  const url = `${DOWNLOAD_BASE}/${version}/${releaseTarget()}`;
  logger.info(`Downloading ${url}`);
  await download(url, bin);
  await chmod(bin, 0o755);
  return bin;
}

export interface StartOptions {
  apiKey: string;
  tunnelName: string;
  onlyHosts?: string;
  excludeHosts?: string;
  waitForReady: string;
}

export async function startTunnel(
  bin: string,
  opts: StartOptions,
): Promise<void> {
  const args = [
    '--daemon',
    'start',
    '--tunnel-name',
    opts.tunnelName,
    '--wait-for-ready',
    opts.waitForReady,
  ];
  if (opts.onlyHosts) args.push('--only-hosts', opts.onlyHosts);
  if (opts.excludeHosts) args.push('--exclude-hosts', opts.excludeHosts);

  // Recorded before starting, not after. If the start times out after the
  // tunnel has in fact connected, the post step still knows what to stop —
  // leaking a tunnel holds its name against the next run, while a redundant
  // stop costs nothing.
  await mkdir(stateDir(), { recursive: true });
  await writeFile(nameFile(), opts.tunnelName, 'utf8');

  try {
    const { stdout } = await execFileAsync(bin, args, {
      env: { ...process.env, MOBILEBOOST_API_KEY: opts.apiKey },
    });
    if (stdout.trim()) logger.info(stdout.trim());
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = [e.stdout, e.stderr].filter(Boolean).join('').trim();
    throw new MobileBoostError(
      `Could not open the tunnel: ${detail || e.message || 'unknown error'}`,
    );
  }
}

/** The tunnel this action started, or null if it never got that far. */
export async function recordedTunnelName(): Promise<string | null> {
  try {
    const name = (await readFile(nameFile(), 'utf8')).trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function stopTunnel(
  bin: string,
  tunnelName: string,
): Promise<void> {
  try {
    const { stdout } = await execFileAsync(bin, [
      '--daemon',
      'stop',
      '--tunnel-name',
      tunnelName,
    ]);
    if (stdout.trim()) logger.info(stdout.trim());
  } finally {
    await unlink(nameFile()).catch(() => undefined);
  }
}
