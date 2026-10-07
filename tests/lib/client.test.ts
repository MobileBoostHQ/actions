import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nock from 'nock';
import { createClient } from '../../src/lib/client';
import { ApiError } from '../../src/lib/errors';

const BASE = 'https://api.test.local';
const KEY = 'mb_live_testkey';

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('getRunStatus', () => {
  it('maps the response to RunStatus', async () => {
    nock(BASE)
      .get('/runs/run1')
      .reply(200, {
        runId: 'run1',
        status: 'completed',
        totalTests: 2,
        succeededTests: [
          { id: 'a', title: 'A', status: 'succeeded', recording: 'http://r/a' },
        ],
        failedTests: [
          { id: 'b', title: 'B', status: 'failed', recording: 'http://r/b' },
        ],
        blockedTests: [],
      });

    const res = await createClient(KEY, BASE).getRunStatus('run1');
    expect(res.status).toBe('completed');
    expect(res.totalTests).toBe(2);
    expect(res.succeededTests).toHaveLength(1);
    expect(res.succeededTests[0]?.title).toBe('A');
    expect(res.failedTests[0]?.id).toBe('b');
    expect(res.blockedTests).toEqual([]);
  });

  it('defaults missing arrays to empty', async () => {
    nock(BASE).get('/runs/run2').reply(200, { status: 'running' });
    const res = await createClient(KEY, BASE).getRunStatus('run2');
    expect(res.runId).toBe('run2');
    expect(res.failedTests).toEqual([]);
    expect(res.skippedTests).toEqual([]);
    expect(res.totalTests).toBe(0);
  });

  it('maps tests the run did not schedule', async () => {
    nock(BASE)
      .get('/runs/run3')
      .reply(200, {
        runId: 'run3',
        status: 'completed',
        totalTests: 1,
        succeededTests: [
          { id: 'e1', title: 'A', status: 'succeeded', recording: '' },
        ],
        skippedTests: [
          {
            testId: 't9',
            title: 'Owner books a walk',
            platform: 'android',
            reason: 'not_automated',
            detail: 'No automation has been generated for this test yet.',
          },
          // Missing fields and a reason this version does not know.
          { testId: 't10', reason: 'something_new' },
        ],
      });

    const res = await createClient(KEY, BASE).getRunStatus('run3');
    expect(res.totalTests).toBe(1);
    expect(res.skippedTests).toEqual([
      {
        testId: 't9',
        title: 'Owner books a walk',
        platform: 'android',
        reason: 'not_automated',
        detail: 'No automation has been generated for this test yet.',
      },
      {
        testId: 't10',
        title: '',
        platform: '',
        reason: 'something_new',
        detail: '',
      },
    ]);
  });

  it('maps 401 to an actionable ApiError without retrying', async () => {
    const scope = nock(BASE).get('/runs/run1').reply(401, { detail: 'nope' });
    await expect(createClient(KEY, BASE).getRunStatus('run1')).rejects.toThrow(
      /Invalid API key/,
    );
    expect(scope.isDone()).toBe(true); // exactly one call
  });

  it('does not retry 4xx', async () => {
    nock(BASE).get('/runs/run1').reply(400, { detail: 'bad' });
    await expect(
      createClient(KEY, BASE).getRunStatus('run1'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(nock.isDone()).toBe(true);
  });

  it('retries on 5xx then succeeds', async () => {
    nock(BASE).get('/runs/run1').reply(500, 'boom');
    nock(BASE)
      .get('/runs/run1')
      .reply(200, { runId: 'run1', status: 'completed', totalTests: 0 });

    const res = await createClient(KEY, BASE).getRunStatus('run1');
    expect(res.status).toBe('completed');
    expect(nock.isDone()).toBe(true);
  }, 20_000);
});

describe('triggerRun', () => {
  it('sends mapped lowercase fields and returns the first run id', async () => {
    nock(BASE)
      .post('/tests/execute', (body: Record<string, unknown>) => {
        return (
          body['organisationid'] === 'org1' &&
          body['buildid'] === 'build1' &&
          Array.isArray(body['tags'])
        );
      })
      .reply(200, {
        message: 'Test suite runs created',
        test_suite_ids: ['s1'],
        status: 'running',
      });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'org1',
      buildId: 'build1',
      tags: ['smoke'],
    });
    expect(res.runId).toBe('s1');
    expect(res.allRunIds).toEqual(['s1']);
    expect(res.backend).toBe('qa-studio');
    expect(res.status).toBe('running');
  });

  it('names an installed app by bundle id and platform instead of a build', async () => {
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/execute', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { runId: 'r1', status: 'running' });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'org1',
      bundleId: 'com.strava',
      platform: 'android',
      tags: ['smoke'],
    });

    expect(received['bundleid']).toBe('com.strava');
    expect(received['platform']).toBe('android');
    expect('buildid' in received).toBe(false);
    expect(res.backend).toBe('platform');
  });

  it('sends no bundle id or platform for a build', async () => {
    // A platform next to a build would override the one the build carries.
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/execute', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { test_suite_ids: ['s1'], status: 'running' });

    await createClient(KEY, BASE).triggerRun({
      organisationId: 'org1',
      buildId: 'build1',
      tags: ['smoke'],
    });

    expect('bundleid' in received).toBe(false);
    expect('platform' in received).toBe(false);
  });

  it('returns all run ids when iterations > 1', async () => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, { test_suite_ids: ['s1', 's2'], status: 'running' });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    expect(res.runId).toBe('s1');
    expect(res.allRunIds).toEqual(['s1', 's2']);
    expect(res.backend).toBe('qa-studio');
  });

  it('fails loudly when test_suite_ids is empty', async () => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, { test_suite_ids: [], status: 'running' });

    await expect(
      createClient(KEY, BASE).triggerRun({
        organisationId: 'o',
        buildId: 'b',
        tags: ['x'],
      }),
    ).rejects.toThrow(/no test_suite_ids, runId or run_id/);
  });

  // A Platform organisation runs /tests/execute as an autotest run, which
  // answers with one run id rather than suite ids.
  it.each([
    ['runId', { runId: 'pr1' }],
    ['run_id', { run_id: 'pr1' }],
    ['runId and run_id', { runId: 'pr1', run_id: 'pr1' }],
  ])('tracks a Platform run id answered as %s', async (_label, ids) => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, { message: 'Autotest run created', status: 'running', ...ids });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    expect(res.runId).toBe('pr1');
    expect(res.allRunIds).toEqual(['pr1']);
    expect(res.backend).toBe('platform');
    expect(res.status).toBe('running');
  });

  it('reads skipped tests and warnings from a Platform answer', async () => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, {
        runId: 'pr2',
        status: 'running',
        scheduledTests: 47,
        skippedTests: [
          {
            testId: 't1',
            title: 'Owner books a walk',
            platform: 'android',
            reason: 'generation_in_progress',
            detail: 'Automation for android is being generated.',
          },
        ],
        warnings: ['1 of 48 tests matching tags [owner-android] was not scheduled.'],
      });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['owner-android'],
    });
    expect(res.skippedTests).toHaveLength(1);
    expect(res.skippedTests[0]?.reason).toBe('generation_in_progress');
    expect(res.warnings).toEqual([
      '1 of 48 tests matching tags [owner-android] was not scheduled.',
    ]);
  });

  it('answers no skipped tests or warnings for a QA Studio suite', async () => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, { test_suite_ids: ['s1'], status: 'running' });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    expect(res.skippedTests).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('prefers suite ids when a response carries both', async () => {
    nock(BASE)
      .post('/tests/execute')
      .reply(200, { test_suite_ids: ['s1'], runId: 'pr1', status: 'running' });

    const res = await createClient(KEY, BASE).triggerRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    expect(res.runId).toBe('s1');
    expect(res.allRunIds).toEqual(['s1']);
    expect(res.backend).toBe('qa-studio');
  });
});

describe('uploadBuild', () => {
  it('posts multipart and maps app_link', async () => {
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mb-upload-')),
      'app.zip',
    );
    fs.writeFileSync(tmp, 'zip-bytes');

    const scope = nock(BASE)
      .post('/uploadBuild/')
      .reply(200, {
        buildId: 'bid123',
        app_link: 'https://app.mobileboost.io/gpt-driver/build/bid123',
      });

    const res = await createClient(KEY, BASE).uploadBuild({
      filePath: tmp,
      organisationId: 'org1',
    });
    expect(res.buildId).toBe('bid123');
    expect(res.appLink).toBe(
      'https://app.mobileboost.io/gpt-driver/build/bid123',
    );
    expect(scope.isDone()).toBe(true);
  });

  it('includes the ci form field when provided', async () => {
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mb-upload-ci-')),
      'app.zip',
    );
    fs.writeFileSync(tmp, 'zip-bytes');

    let receivedBody = '';
    const scope = nock(BASE)
      .post('/uploadBuild/', (body) => {
        receivedBody = typeof body === 'string' ? body : JSON.stringify(body);
        return true;
      })
      .reply(200, { buildId: 'bid', app_link: 'http://x/bid' });

    await createClient(KEY, BASE).uploadBuild({
      filePath: tmp,
      organisationId: 'org1',
      ci: '{"commitSha":"abc","branch":"main"}',
    });
    expect(scope.isDone()).toBe(true);
    expect(receivedBody).toContain('name="ci"');
    expect(receivedBody).toContain('"commitSha":"abc"');
  });
});

describe('triggerAutotestRun', () => {
  it('posts camelCase fields, names the build uploadId, and marks the run as CI', async () => {
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, {
        message: 'Autotest run created',
        run_id: 'ar1',
        status: 'running',
      });

    const res = await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      buildId: 'build1',
      tags: ['smoke'],
      testsRepo: 'https://github.com/acme/tests.git',
      usePhysicalDevice: true,
    });

    // /tests/run is NOT the CaseInsensitiveBaseModel endpoint /tests/execute is.
    expect(received['organisationId']).toBe('org1');
    expect(received['uploadId']).toBe('build1');
    expect(received['buildId']).toBeUndefined();
    expect(received['trigger']).toBe('ci');
    expect(received['testsRepo']).toBe('https://github.com/acme/tests.git');
    expect(received['usePhysicalDevice']).toBe(true);

    expect(res.runId).toBe('ar1');
    expect(res.allRunIds).toEqual(['ar1']);
    expect(res.backend).toBe('platform');
    expect(res.status).toBe('running');
  });

  it('names an installed app by bundleId and platform instead of uploadId', async () => {
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { runId: 'ar5', status: 'running' });

    await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      bundleId: 'com.strava.stravaride',
      platform: 'ios',
      tags: ['smoke'],
    });

    expect(received['bundleId']).toBe('com.strava.stravaride');
    expect(received['platform']).toBe('ios');
    expect('uploadId' in received).toBe(false);
    expect(received['trigger']).toBe('ci');
  });

  it('sends no bundleId or platform for a build', async () => {
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { runId: 'ar6', status: 'running' });

    await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      buildId: 'build1',
    });

    expect(received['uploadId']).toBe('build1');
    expect('bundleId' in received).toBe(false);
    expect('platform' in received).toBe(false);
  });

  it('forwards a tunnel name so the app can reach the caller network', async () => {
    // The whole point of the tunnel: without this field the run goes ahead on
    // the device's ordinary egress and every request to an internal host times
    // out, which reads as a broken test rather than a missing setting.
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { run_id: 'ar2', status: 'running' });

    await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      buildId: 'build1',
      tunnelName: 'gh-123-1-e2e',
    });

    expect(received['tunnelName']).toBe('gh-123-1-e2e');
  });

  it('omits the tunnel name when the run does not use one', async () => {
    // Omitted rather than null: a run without a tunnel must use the device's
    // normal egress, not be handed an empty name to resolve.
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { run_id: 'ar3', status: 'running' });

    await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      buildId: 'build1',
    });

    expect('tunnelName' in received).toBe(false);
  });

  it('omits selectors that were not provided', async () => {
    let received: Record<string, unknown> = {};
    nock(BASE)
      .post('/tests/run', (body: Record<string, unknown>) => {
        received = body;
        return true;
      })
      .reply(200, { run_id: 'ar2', status: 'running' });

    await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'org1',
      buildId: 'build1',
      testIds: ['t1'],
    });
    expect(received['testIds']).toEqual(['t1']);
    expect(received['tags']).toBeUndefined();
    expect(received['testsRepo']).toBeUndefined();
    expect(received['usePhysicalDevice']).toBeUndefined();
  });

  it.each([
    ['runId', { runId: 'ar4' }],
    ['run_id', { run_id: 'ar4' }],
    ['runId and run_id', { runId: 'ar4', run_id: 'ar4' }],
  ])('reads the run id answered as %s', async (_label, ids) => {
    nock(BASE)
      .post('/tests/run')
      .reply(200, { message: 'Autotest run created', status: 'running', ...ids });

    const res = await createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    expect(res.runId).toBe('ar4');
    expect(res.allRunIds).toEqual(['ar4']);
    expect(res.backend).toBe('platform');
  });

  it('reads skipped tests and defaults them when absent', async () => {
    nock(BASE)
      .post('/tests/run')
      .reply(200, {
        runId: 'ar5',
        status: 'running',
        skippedTests: [
          { testId: 't2', title: 'Walker signs in', platform: 'ios', reason: 'not_automated', detail: '' },
        ],
      });
    nock(BASE).post('/tests/run').reply(200, { runId: 'ar6', status: 'running' });

    const client = createClient(KEY, BASE);
    const opts = { organisationId: 'o', buildId: 'b', tags: ['x'] };
    const withSkipped = await client.triggerAutotestRun(opts);
    expect(withSkipped.skippedTests[0]?.title).toBe('Walker signs in');
    expect(withSkipped.warnings).toEqual([]);

    const older = await client.triggerAutotestRun(opts);
    expect(older.skippedTests).toEqual([]);
    expect(older.warnings).toEqual([]);
  });

  it('fails loudly when neither runId nor run_id is present', async () => {
    nock(BASE).post('/tests/run').reply(200, { message: 'ok' });
    const call = createClient(KEY, BASE).triggerAutotestRun({
      organisationId: 'o',
      buildId: 'b',
      tags: ['x'],
    });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toThrow(/no runId or run_id/);
  });
});

describe('getAutotestRunStatus', () => {
  it('reads the autotest path, not the suite path', async () => {
    const scope = nock(BASE)
      .get('/autotest/runs/ar1')
      .reply(200, {
        runId: 'ar1',
        status: 'completed',
        totalTests: 2,
        succeededTests: [
          { id: 'e1', title: 'test_a.py', status: 'succeeded', recording: 'http://r/e1' },
        ],
        failedTests: [
          { id: 'e2', title: 'test_b.py', status: 'failed', recording: 'http://r/e2' },
        ],
      });

    const res = await createClient(KEY, BASE).getAutotestRunStatus('ar1');
    expect(scope.isDone()).toBe(true);
    expect(res.status).toBe('completed');
    expect(res.succeededTests[0]?.title).toBe('test_a.py');
    expect(res.failedTests[0]?.id).toBe('e2');
    expect(res.blockedTests).toEqual([]);
  });
});
