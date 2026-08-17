import { existsSync } from 'fs';

import * as core from '@actions/core';

import { logger } from '../lib/logger';
import { binaryPath, recordedTunnelName, stopTunnel } from './tunnel';

/**
 * Close the tunnel, however the job ended.
 *
 * Declared with `post-if: always()`, so this runs on failure and cancellation
 * too. That is the reason this action is JavaScript rather than composite:
 * composite actions cannot register a post step, and a leaked tunnel is not
 * harmless. It holds its name, so the next run of the same job fails with
 * "already connected", and it counts against the organisation's tunnel quota
 * until the server reaps it.
 *
 * Nothing here fails the job. By this point the tests have already passed or
 * failed, and turning a green run red over a cleanup hiccup would be worse than
 * the leak it is reporting.
 */
async function post(): Promise<void> {
  try {
    const tunnelName = await recordedTunnelName();
    if (!tunnelName) {
      logger.info('No tunnel was started by this action; nothing to stop.');
      return;
    }

    const bin = binaryPath();
    if (!existsSync(bin)) {
      logger.warning(
        `mb-local is no longer at ${bin}, so tunnel "${tunnelName}" could not be stopped ` +
          'here. It will be reaped server-side once it stops reporting.',
      );
      return;
    }

    await stopTunnel(bin, tunnelName);
    logger.info(`Tunnel "${tunnelName}" stopped.`);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = [e.stdout, e.stderr].filter(Boolean).join('').trim();
    core.warning(
      `Could not stop the tunnel: ${detail || e.message || String(err)}. ` +
        'It will be reaped server-side once it stops reporting.',
    );
  }
}

void post();
