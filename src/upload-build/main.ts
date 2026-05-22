import * as core from '@actions/core';
import { createClient } from '../lib/client';
import { MobileBoostError } from '../lib/errors';
import { formatBytes } from '../lib/format';
import { logger } from '../lib/logger';
import { normalizePlatform, parseJsonObject } from '../lib/validate';
import { uploadBuild, UploadOutcome } from './upload';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const organisationId = core.getInput('organisation-id', { required: true });
    const buildPath = core.getInput('build-path', { required: true });
    const platform = normalizePlatform(core.getInput('platform'));
    const metadataInput = core.getInput('metadata');
    // The API runs json.loads() on this field, so it must be a JSON object.
    // Validate up front for a clear error instead of a server-side 500.
    if (metadataInput) parseJsonObject('metadata', metadataInput);
    const apiUrl = core.getInput('api-url') || 'https://api.mobileboost.io';

    const client = createClient(apiKey, apiUrl);
    const outcome = await uploadBuild(client, {
      organisationId,
      platform,
      buildPath,
      metadata: metadataInput || undefined,
    });

    core.setOutput('build-id', outcome.result.buildId);
    core.setOutput('app-link', outcome.result.appLink);

    await writeSummary(outcome);
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

async function writeSummary(outcome: UploadOutcome): Promise<void> {
  const { result, fileName, sizeBytes, platform } = outcome;
  const wireSnippet = [
    '- uses: mobileboost/actions/run-tests@v1',
    '  with:',
    '    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}',
    '    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}',
    `    build-id: ${result.buildId}`,
    '    tags: smoke',
  ].join('\n');

  await core.summary
    .addHeading('MobileBoost — Build Uploaded', 2)
    .addTable([
      [
        { data: 'Field', header: true },
        { data: 'Value', header: true },
      ],
      ['Build', fileName],
      ['Size', formatBytes(sizeBytes)],
      ['Platform', platform ?? '(inferred)'],
      ['Build ID', `<code>${result.buildId}</code>`],
    ])
    .addLink('Open build in dashboard', result.appLink)
    .addHeading('Wire into run-tests', 3)
    .addCodeBlock(wireSnippet, 'yaml')
    .write();
}

void run();
