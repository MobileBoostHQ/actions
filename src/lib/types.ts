// Normalized, camelCase shapes used everywhere downstream of the client.
// The client is the only place that touches the API's snake_case / lowercase
// wire fields; see client.ts for the field mapping at the boundary.

export interface UploadResult {
  /** Firestore upload document id; pass to run-tests as `build-id`. */
  buildId: string;
  /** Dashboard URL for the uploaded build (API field `app_link`). */
  appLink: string;
}

export interface TriggerResult {
  /** The run id the action tracks (== `test_suite_ids[0]`). */
  runId: string;
  /** All ids returned by the API (one per `iterations`). */
  allRunIds: string[];
  /** Wire status of the trigger call: `queued` or `running`. */
  status: string;
  message: string;
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
}
