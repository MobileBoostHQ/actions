import * as fs from 'fs';
import * as path from 'path';
import { HttpClient } from '@actions/http-client';
import FormData from 'form-data';
import { ApiError, TimeoutError } from './errors';
import { logger } from './logger';
import { RunStatus, TestResult, TriggerResult, UploadResult } from './types';

const USER_AGENT = 'mobileboost-actions';

// Retry policy: exponential backoff on 5xx and network errors only.
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

// Per-request time budgets.
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface UploadBuildOptions {
  filePath: string;
  organisationId: string;
  metadata?: string;
  ci?: string;
}

export interface TriggerRunOptions {
  organisationId: string;
  buildId: string;
  testIds?: string[];
  tags?: string[];
  tagsQuery?: string;
  iterations?: number;
  launchParams?: Record<string, unknown>;
  deviceProviderSettings?: Record<string, unknown>;
  testInputs?: Record<string, unknown>;
  deviceConfigs?: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * Autotest runs (pytest files executed on real devices) live behind a different
 * endpoint pair to GPT-Driver suites, with a different selection model: no
 * tags-query, no iterations, and the tests come from the org's test repo.
 */
export interface TriggerAutotestRunOptions {
  organisationId: string;
  buildId: string;
  testIds?: string[];
  tags?: string[];
  testsRepo?: string;
  usePhysicalDevice?: boolean;
}

export interface MobileBoostClient {
  uploadBuild(opts: UploadBuildOptions): Promise<UploadResult>;
  triggerRun(opts: TriggerRunOptions): Promise<TriggerResult>;
  getRunStatus(runId: string): Promise<RunStatus>;
  triggerAutotestRun(opts: TriggerAutotestRunOptions): Promise<TriggerResult>;
  getAutotestRunStatus(runId: string): Promise<RunStatus>;
}

export function createClient(
  apiKey: string,
  baseUrl: string,
): MobileBoostClient {
  const base = baseUrl.replace(/\/+$/, '');
  const http = new HttpClient(USER_AGENT);
  const authHeader = { Authorization: `Bearer ${apiKey}` };

  /** Both status endpoints answer in the same shape; only the path differs. */
  const fetchRunStatus = async (
    url: string,
    runId: string,
  ): Promise<RunStatus> => {
    const body = await withRetry('getRunStatus', REQUEST_TIMEOUT_MS, () =>
      http.get(url, { ...authHeader, Accept: 'application/json' }),
    );
    const json = parseJson(body, url);
    return {
      runId: asString(json['runId']) || runId,
      status: asString(json['status']) || 'unknown',
      totalTests: asNumber(json['totalTests']),
      succeededTests: normalizeTests(json['succeededTests']),
      failedTests: normalizeTests(json['failedTests']),
      blockedTests: normalizeTests(json['blockedTests']),
    };
  };

  return {
    async uploadBuild(opts: UploadBuildOptions): Promise<UploadResult> {
      // Each attempt needs a fresh stream — a consumed multipart body can't be
      // replayed, so we rebuild the FormData inside the retried operation.
      const url = `${base}/uploadBuild/`;
      const body = await withRetry('uploadBuild', UPLOAD_TIMEOUT_MS, () => {
        const form = new FormData();
        form.append('build', fs.createReadStream(opts.filePath), {
          filename: path.basename(opts.filePath),
        });
        form.append('organisation_key', opts.organisationId);
        if (opts.metadata !== undefined) form.append('metadata', opts.metadata);
        if (opts.ci !== undefined) form.append('ci', opts.ci);
        return http.sendStream('POST', url, form, {
          ...form.getHeaders(),
          ...authHeader,
          Accept: 'application/json',
        });
      });

      const json = parseJson(body, url);
      const buildId = asString(json['buildId']);
      if (!buildId) {
        throw new ApiError(
          200,
          `Upload succeeded but the response had no buildId. Response: ${truncate(body)}`,
          body,
        );
      }
      return { buildId, appLink: asString(json['app_link']) };
    },

    async triggerRun(opts: TriggerRunOptions): Promise<TriggerResult> {
      const url = `${base}/tests/execute`;
      // Lowercase keys are valid aliases of the CaseInsensitiveBaseModel on the
      // backend; `buildid` is internally remapped to uploadId. Only send keys
      // the caller actually provided.
      const payload: Record<string, unknown> = {
        organisationid: opts.organisationId,
        buildid: opts.buildId,
      };
      if (opts.testIds?.length) payload['testids'] = opts.testIds;
      if (opts.tags?.length) payload['tags'] = opts.tags;
      if (opts.tagsQuery) payload['tagsquery'] = opts.tagsQuery;
      if (opts.iterations !== undefined) payload['iterations'] = opts.iterations;
      if (opts.launchParams) payload['launchparams'] = opts.launchParams;
      if (opts.deviceProviderSettings)
        payload['deviceprovidersettings'] = opts.deviceProviderSettings;
      if (opts.testInputs) payload['testinputs'] = opts.testInputs;
      if (opts.deviceConfigs) payload['deviceconfigs'] = opts.deviceConfigs;
      if (opts.metadata) payload['metadata'] = opts.metadata;

      const body = await withRetry('triggerRun', REQUEST_TIMEOUT_MS, () =>
        http.post(url, JSON.stringify(payload), {
          ...authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      );

      const json = parseJson(body, url);
      const ids = asStringArray(json['test_suite_ids']);
      const first = ids[0];
      if (!first) {
        throw new ApiError(
          200,
          `Trigger returned no test_suite_ids — nothing to track. Response: ${truncate(body)}`,
          body,
        );
      }
      return {
        runId: first,
        allRunIds: ids,
        status: asString(json['status']) || 'unknown',
        message: asString(json['message']),
      };
    },

    async getRunStatus(runId: string): Promise<RunStatus> {
      // Org is derived server-side from the API key, so no org param here.
      return fetchRunStatus(`${base}/runs/${encodeURIComponent(runId)}`, runId);
    },

    async triggerAutotestRun(
      opts: TriggerAutotestRunOptions,
    ): Promise<TriggerResult> {
      const url = `${base}/tests/run`;
      // This endpoint takes the exact camelCase field names (it is not the
      // CaseInsensitiveBaseModel the /tests/execute payload goes through), and
      // names the build `uploadId` rather than `buildId`.
      const payload: Record<string, unknown> = {
        organisationId: opts.organisationId,
        uploadId: opts.buildId,
        // Provenance only — recorded on the run doc and used to tell CI runs
        // apart from dashboard ones. It does NOT gate the PR comment: that is
        // decided by the org's enableAutotestPrComments flag and whether the
        // build carries CI metadata.
        trigger: 'ci',
      };
      if (opts.testIds?.length) payload['testIds'] = opts.testIds;
      if (opts.tags?.length) payload['tags'] = opts.tags;
      if (opts.testsRepo) payload['testsRepo'] = opts.testsRepo;
      if (opts.usePhysicalDevice !== undefined) {
        payload['usePhysicalDevice'] = opts.usePhysicalDevice;
      }

      const body = await withRetry('triggerAutotestRun', REQUEST_TIMEOUT_MS, () =>
        http.post(url, JSON.stringify(payload), {
          ...authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      );

      const json = parseJson(body, url);
      // The background-test server answers with a single run id — there is no
      // iterations concept here, so allRunIds is always that one id.
      const runId = asString(json['run_id']);
      if (!runId) {
        throw new ApiError(
          200,
          `Autotest trigger returned no run_id — nothing to track. Response: ${truncate(body)}`,
          body,
        );
      }
      return {
        runId,
        allRunIds: [runId],
        status: asString(json['status']) || 'unknown',
        message: asString(json['message']),
      };
    },

    async getAutotestRunStatus(runId: string): Promise<RunStatus> {
      // Separate path from getRunStatus: /runs/{id} resolves against the suite
      // collection, which knows nothing about autotest runs.
      return fetchRunStatus(
        `${base}/autotest/runs/${encodeURIComponent(runId)}`,
        runId,
      );
    },
  };
}

// --- internals -------------------------------------------------------------

interface RawResponse {
  message: { statusCode?: number };
  readBody(): Promise<string>;
}

/**
 * Runs `op` with an overall time budget and retry/backoff. Retries on 5xx and
 * network/timeout errors; never retries 4xx. Returns the response body string.
 */
async function withRetry(
  label: string,
  timeoutMs: number,
  op: () => Promise<RawResponse>,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(label, timeoutMs, op());
      const status = res.message.statusCode ?? 0;
      const body = await res.readBody();

      if (status >= 200 && status < 300) return body;

      if (status >= 400 && status < 500) {
        // Client error — actionable, no point retrying.
        throw mapClientError(status, body);
      }

      // 5xx (or 0/unknown) — retryable.
      lastError = new ApiError(
        status,
        `MobileBoost API returned ${status} for ${label}: ${truncate(extractDetail(body))}`,
        body,
      );
    } catch (err) {
      if (err instanceof ApiError && err.statusCode >= 400 && err.statusCode < 500) {
        throw err; // do not retry client errors
      }
      lastError =
        err instanceof Error ? err : new Error(`Unknown error in ${label}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = backoffDelay(attempt);
      logger.warning(
        `${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError.message}). Retrying in ${Math.round(
          delay / 1000,
        )}s…`,
      );
      await sleep(delay);
    }
  }

  throw (
    lastError ??
    new ApiError(0, `${label} failed after ${MAX_ATTEMPTS} attempts`)
  );
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  // Full jitter keeps concurrent jobs from retrying in lockstep.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function withTimeout<T>(
  label: string,
  ms: number,
  promise: Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}

function mapClientError(status: number, body: string): ApiError {
  const detail = extractDetail(body);
  switch (status) {
    case 401:
      return new ApiError(
        401,
        'Invalid API key (401). Check the `api-key` input and that the secret is set in the repository settings.',
        body,
      );
    case 403:
      return new ApiError(
        403,
        'Forbidden (403). The API key may not have access to this organisation.',
        body,
      );
    case 404:
      return new ApiError(
        404,
        `Not found (404): ${truncate(detail)}`,
        body,
      );
    default:
      return new ApiError(
        status,
        `Request rejected (${status}): ${truncate(detail)}`,
        body,
      );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- safe JSON access (avoids `any`) ---------------------------------------

function parseJson(body: string, url: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('not a JSON object');
  } catch {
    throw new ApiError(
      0,
      `Could not parse JSON response from ${url}: ${truncate(body)}`,
      body,
    );
  }
}

/** FastAPI surfaces errors as {"detail": "..."}; fall back to the raw body. */
function extractDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
  } catch {
    // not JSON — fall through
  }
  return body;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((s) => s.length > 0);
}

function normalizeTests(value: unknown): TestResult[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): TestResult => {
    const obj =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : {};
    return {
      id: asString(obj['id']),
      title: asString(obj['title']),
      status: asString(obj['status']),
      recording: asString(obj['recording']),
    };
  });
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
