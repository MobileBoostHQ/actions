import { parseAppTarget } from '../../src/run-tests/target';
import { InvalidInputError } from '../../src/lib/errors';

const none = { buildId: '', bundleId: '', platform: '' };

describe('parseAppTarget', () => {
  it('takes an uploaded build', () => {
    expect(parseAppTarget({ ...none, buildId: ' b1 ' })).toEqual({
      buildId: 'b1',
    });
  });

  it('takes an installed app by bundle id and platform', () => {
    expect(
      parseAppTarget({ ...none, bundleId: 'com.strava', platform: 'android' }),
    ).toEqual({ bundleId: 'com.strava', platform: 'android' });
  });

  it('is forgiving about the case and padding of the platform', () => {
    expect(
      parseAppTarget({ ...none, bundleId: 'com.x', platform: ' iOS ' }),
    ).toEqual({ bundleId: 'com.x', platform: 'ios' });
  });

  it('refuses both a build and a bundle id', () => {
    // The API refuses this too, but only after the run has been asked for;
    // saying so here names the inputs the workflow actually has.
    expect(() =>
      parseAppTarget({ buildId: 'b1', bundleId: 'com.x', platform: 'ios' }),
    ).toThrow(/either `build-id` or `bundle-id`, not both/);
  });

  it('refuses neither, and names both ways out', () => {
    expect(() => parseAppTarget(none)).toThrow(InvalidInputError);
    expect(() => parseAppTarget(none)).toThrow(/`build-id`.*`bundle-id`/);
  });

  it('requires a platform with a bundle id', () => {
    // A bundle id carries no platform: there is no upload to read it from.
    expect(() => parseAppTarget({ ...none, bundleId: 'com.x' })).toThrow(
      /`platform` \(ios or android\) is required with `bundle-id`/,
    );
  });

  it('names the valid platforms when given something else', () => {
    expect(() =>
      parseAppTarget({ ...none, bundleId: 'com.x', platform: 'web' }),
    ).toThrow(/Expected one of: ios, android/);
  });

  it('refuses a platform next to a build id rather than letting it override the build', () => {
    expect(() =>
      parseAppTarget({ ...none, buildId: 'b1', platform: 'ios' }),
    ).toThrow(/only used with `bundle-id`/);
  });
});
