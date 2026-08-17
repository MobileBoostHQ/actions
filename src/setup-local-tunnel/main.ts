import * as core from '@actions/core';

import { MobileBoostError } from '../lib/errors';
import { logger } from '../lib/logger';
import { defaultTunnelName, installBinary, startTunnel } from './tunnel';

const DOCS_CI = 'https://docs.mobileboost.io/test-agent/local-testing-ci';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const version = core.getInput('version') || 'latest';
    const waitForReady = core.getInput('wait-for-ready') || '60s';
    const onlyHosts = core.getInput('only-hosts').trim();
    const excludeHosts = core.getInput('exclude-hosts').trim();
    const tunnelName =
      core.getInput('tunnel-name').trim() || defaultTunnelName();

    // The failure this catches is otherwise silent and expensive. A
    // GitHub-hosted runner sits outside the customer's network, so the tunnel
    // connects perfectly well and then every request through it fails deep
    // inside a test, looking like a broken test suite rather than a
    // misplaced tunnel.
    if (process.env.RUNNER_ENVIRONMENT === 'github-hosted') {
      logger.warning(
        'This is a GitHub-hosted runner, which sits outside your network and cannot ' +
          'reach your internal services. A tunnel opened here will connect but carry ' +
          'nothing. Run this on a self-hosted runner inside your network, or point the ' +
          `run at a shared tunnel instead. See ${DOCS_CI}`,
      );
    }

    // Not fatal, but worth saying once: without it every host the app asks for
    // is tunnelled, including the runner's own traffic.
    if (!onlyHosts) {
      logger.warning(
        'No `only-hosts` set, so this tunnel will carry every host the app asks for. ' +
          'Listing your internal hosts keeps unrelated traffic off it.',
      );
    }

    logger.startGroup('Install mb-local');
    const bin = await installBinary(version);
    logger.endGroup();

    logger.startGroup('Open the tunnel');
    await startTunnel(bin, {
      apiKey,
      tunnelName,
      onlyHosts: onlyHosts || undefined,
      excludeHosts: excludeHosts || undefined,
      waitForReady,
    });
    logger.endGroup();

    core.setOutput('tunnel-name', tunnelName);
    core.exportVariable('MOBILEBOOST_TUNNEL_NAME', tunnelName);
    core.info(
      `Tunnel "${tunnelName}" is ready. Pass it as tunnelName when you trigger a run.`,
    );
  } catch (err) {
    if (err instanceof MobileBoostError) {
      core.setFailed(err.message);
      return;
    }
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void run();
