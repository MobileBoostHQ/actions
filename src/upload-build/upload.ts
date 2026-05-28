import * as path from 'path';
import { MobileBoostClient } from '../lib/client';
import { resolveBuildPath } from '../lib/files';
import { formatBytes } from '../lib/format';
import { logger } from '../lib/logger';
import { UploadResult } from '../lib/types';

// Warn (don't fail) above this size; large uploads still work but are slow.
const WARN_SIZE_BYTES = 500 * 1024 * 1024;

export interface UploadParams {
  organisationId: string;
  buildPath: string;
  metadata?: string;
  ci?: string;
}

export interface UploadOutcome {
  result: UploadResult;
  fileName: string;
  sizeBytes: number;
}

/** Resolves the build path and uploads it. Pure-ish: no input/output wiring. */
export async function uploadBuild(
  client: MobileBoostClient,
  params: UploadParams,
): Promise<UploadOutcome> {
  const resolved = await resolveBuildPath(params.buildPath);
  const fileName = path.basename(resolved.filePath);

  logger.info(
    `Uploading ${fileName} (${formatBytes(resolved.sizeBytes)})` +
      (resolved.zippedFromDir ? ' [zipped from directory]' : ''),
  );
  if (resolved.sizeBytes > WARN_SIZE_BYTES) {
    logger.warning(
      `Build is ${formatBytes(resolved.sizeBytes)} — uploads above 500 MB can be slow.`,
    );
  }

  const result = await client.uploadBuild({
    filePath: resolved.filePath,
    organisationId: params.organisationId,
    metadata: params.metadata,
    ci: params.ci,
  });

  logger.info(`Upload complete. buildId=${result.buildId}`);
  return {
    result,
    fileName,
    sizeBytes: resolved.sizeBytes,
  };
}
