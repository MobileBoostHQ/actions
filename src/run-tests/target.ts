import { InvalidInputError } from '../lib/errors';
import { AppPlatform, AppTarget } from '../lib/types';

const PLATFORMS: AppPlatform[] = ['ios', 'android'];

export interface AppTargetInputs {
  buildId: string;
  bundleId: string;
  platform: string;
}

/**
 * The app under test, from `build-id`, or from `bundle-id` + `platform` for an
 * app already installed on the organisation's reserved device.
 *
 * `platform` is refused next to `build-id` rather than forwarded: the build
 * already says which platform it is, and the API lets an explicit platform
 * override that, so a stale value in a workflow would send the build to a
 * device it cannot be installed on.
 */
export function parseAppTarget(inputs: AppTargetInputs): AppTarget {
  const buildId = inputs.buildId.trim();
  const bundleId = inputs.bundleId.trim();
  const platform = inputs.platform.trim().toLowerCase();

  if (buildId && bundleId) {
    throw new InvalidInputError(
      'Provide either `build-id` or `bundle-id`, not both.',
    );
  }
  if (buildId) {
    if (platform) {
      throw new InvalidInputError(
        '`platform` is only used with `bundle-id`; a `build-id` run takes its ' +
          'platform from the build.',
      );
    }
    return { buildId };
  }
  if (!bundleId) {
    throw new InvalidInputError(
      'Provide `build-id` (from upload-build), or `bundle-id` and `platform` ' +
        'to test the app already installed on your device.',
    );
  }
  if (!PLATFORMS.includes(platform as AppPlatform)) {
    throw new InvalidInputError(
      platform
        ? `Invalid \`platform\`: "${inputs.platform}". Expected one of: ${PLATFORMS.join(', ')}.`
        : '`platform` (ios or android) is required with `bundle-id`.',
    );
  }
  return { bundleId, platform: platform as AppPlatform };
}
