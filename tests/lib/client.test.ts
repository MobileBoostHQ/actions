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
    expect(res.totalTests).toBe(0);
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
    expect(res.status).toBe('running');
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
    ).rejects.toThrow(/no test_suite_ids/);
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
      platform: 'android',
    });
    expect(res.buildId).toBe('bid123');
    expect(res.appLink).toBe(
      'https://app.mobileboost.io/gpt-driver/build/bid123',
    );
    expect(scope.isDone()).toBe(true);
  });
});
