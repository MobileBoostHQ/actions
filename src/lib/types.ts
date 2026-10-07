// Normalized, camelCase shapes used everywhere downstream of the client.
// The client is the only place that touches the API's snake_case / lowercase
// wire fields; see client.ts for the field mapping at the boundary.

export interface UploadResult {
  /** Firestore upload document id; pass to run-tests as `build-id`. */
  buildId: string;
  /** Dashboard URL for the uploaded build (API field `app_link`). */
  appLink: string;
}

export type AppPlatform = 'ios' | 'android';

/**
 * The app a run tests: a build uploaded by `upload-build`, or one already
 * installed on the organisation's reserved device, named by its bundle id.
 * Exactly one, so a run can neither name both nor name neither. A bundle id
 * carries no platform of its own (there is no upload to read it from), so it
 * always comes with one.
 */
export type AppTarget =
  | { buildId: string }
  | { bundleId: string; platform: AppPlatform };

/**
 * Which product the organisation's run lives in, decided by the answer the
 * trigger call got rather than by the `mode` input: a Platform organisation
 * runs the default mode's /tests/execute as an autotest run too.
 */
export type RunBackend = 'qa-studio' | 'platform';

export interface TriggerResult {
  /**
   * The run id the action tracks: `test_suite_ids[0]` for a QA Studio suite,
   * or the autotest run id (`runId`, formerly `run_id`) for a Platform run.
   */
  runId: string;
  /** Where the run's report is: the QA Studio dashboard or the Platform app. */
  backend: RunBackend;
  /** All ids returned by the API (one per `iterations`). */
  allRunIds: string[];
  /** Wire status of the trigger call: `queued` or `running`. */
  status: string;
  message: string;
  /**
   * Tests the selection matched that the run does not include, because they
   * are not automated for the run's platform yet. Platform runs only, and only
   * for tests matched by a tag: a test named by id that cannot run fails the
   * trigger instead. Empty for QA Studio suites and older backends.
   */
  skippedTests: SkippedTest[];
  /** Human-readable notes from the backend about the trigger, e.g. skipped tests. */
  warnings: string[];
}

/**
 * A test the selection matched but the run left out. It has no execution, is
 * not counted in `totalTests`, and never changes whether the run passes: the
 * backend knew it up front, and nothing about the app was tested.
 */
export interface SkippedTest {
  testId: string;
  title: string;
  platform: string;
  /**
   * Why it is not in the run: `not_automated`, `generation_in_progress`,
   * `generation_failed`, `generation_blocked` or `not_ready`. A plain string
   * on purpose, so a reason the backend adds later still reads as a reason
   * rather than failing the action.
   */
  reason: string;
  /** The backend's own one-line explanation, shown as-is. */
  detail: string;
}

export interface TestResult {
  id: string;
  title: string;
  status: string;
  /** Per-test recording / dashboard URL. */
  recording: string;
}

/**
 * Status of a single run (== one test suite run).
 *
 * `status` is intentionally a free `string`: the backend can return
 * `queued`, `initial`, `running`, `completed`, `cancelled`, `undefined`,
 * or `null` (serialized) depending on lifecycle stage, so we never narrow
 * it to an enum that could drift from the server. Use the helpers in
 * run-tests/poll.ts to classify it.
 */
export interface RunStatus {
  runId: string;
  status: string;
  totalTests: number;
  succeededTests: TestResult[];
  failedTests: TestResult[];
  blockedTests: TestResult[];
  /** See `SkippedTest`. Empty for QA Studio suites and older backends. */
  skippedTests: SkippedTest[];
}
