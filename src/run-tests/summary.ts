import * as core from '@actions/core';
import { SummaryTableRow } from '@actions/core/lib/summary';
import { formatDuration } from '../lib/format';
import { RunBackend, RunStatus, SkippedTest, TestResult } from '../lib/types';
import { reasonLabel } from './skipped';

const APP_BASE_URL = 'https://app.mobileboost.io';
// Autotest runs are reported in the newer platform app, not the gpt-driver
// dashboard — different product surface, different host.
const PLATFORM_BASE_URL = 'https://platform.mobileboost.io';

export type RunMode = 'gpt-driver' | 'ai-sdet';

/**
 * Run-level dashboard (report) URL, per backend that answered the trigger.
 * Not per mode: the default mode's run is a Platform run on a Platform
 * organisation, and its report is in the Platform app like any other.
 */
export function buildRunUrl(
  runId: string,
  backend: RunBackend = 'qa-studio',
): string {
  return backend === 'platform'
    ? `${PLATFORM_BASE_URL}/reports/${runId}`
    : `${APP_BASE_URL}/gpt-driver/reports/${runId}`;
}

export interface RunSummaryOptions {
  durationMs: number;
  runUrl: string;
  cancelled: boolean;
  /** Whether a test that needs review fails the job (`fail-on-needs-review`). */
  failOnNeedsReview?: boolean;
}

/** Title of the warning annotation raised for each test that needs review. */
export const NEEDS_REVIEW_ANNOTATION_TITLE = 'MobileBoost: needs review';

/**
 * The warning annotation for one test that needs review: what it is, why it
 * is neither a pass nor a failure, and where to decide.
 */
export function needsReviewAnnotation(test: TestResult): string {
  const name = test.title || test.id || '(untitled)';
  const where = test.recording ? ` Review it: ${test.recording}` : '';
  return (
    `"${name}" needs review: the agent could not tell a broken test from an ` +
    `intended change in the app, so a person has to decide.${where}`
  );
}

/**
 * The line under the tally when tests need review, saying whether they
 * affect the result. Empty when none do.
 */
export function needsReviewNote(
  run: Pick<RunStatus, 'needsReviewTests'>,
  failOnNeedsReview = false,
): string {
  const count = (run.needsReviewTests ?? []).length;
  if (count === 0) return '';
  const subject = count === 1 ? '1 test needs' : `${count} tests need`;
  const effect = failOnNeedsReview
    ? 'They fail the job because `fail-on-needs-review` is on.'
    : 'They do not fail the job; set `fail-on-needs-review: true` to change that.';
  return (
    `> **${subject} review.** The agent could not tell a broken test from an ` +
    `intended change in the app. ${effect}`
  );
}

export async function writeRunSummary(
  run: RunStatus,
  opts: RunSummaryOptions,
): Promise<void> {
  let summary = core.summary
    .addHeading('MobileBoost — Test Run', 2)
    .addRaw(buildAggregate(run), true)
    .addEOL();

  if (opts.cancelled) {
    summary = summary.addRaw('> **Run was cancelled.**', true).addEOL();
  }

  const reviewNote = needsReviewNote(run, opts.failOnNeedsReview);
  if (reviewNote) {
    summary = summary.addRaw(reviewNote, true).addEOL();
  }

  summary = summary
    .addRaw(`**Duration:** ${formatDuration(opts.durationMs)}`, true)
    .addEOL()
    .addLink('Open run in dashboard', opts.runUrl)
    .addEOL();

  const rows = buildRows(run);
  if (rows.length > 1) {
    summary = summary.addTable(rows);
  }

  if (run.skippedTests.length > 0) {
    summary = summary
      .addHeading('Not scheduled', 3)
      .addRaw(NOT_SCHEDULED_NOTE, true)
      .addEOL()
      .addTable(buildSkippedRows(run.skippedTests));
  }

  await summary.write();
}

const NOT_SCHEDULED_NOTE =
  'These tests matched the selection but are not automated for this ' +
  'platform yet, so the run left them out. They do not affect the result.';

/**
 * The one-line tally. "Need review" and "Not scheduled" only appear when
 * there is something to count, so a summary for a run with neither reads as
 * it always has.
 */
export function buildAggregate(
  run: Pick<
    RunStatus,
    | 'succeededTests'
    | 'failedTests'
    | 'blockedTests'
    | 'skippedTests'
    | 'needsReviewTests'
  >,
): string {
  const sep = '&nbsp;&nbsp;&nbsp;';
  const parts = [
    `✅ ${run.succeededTests.length} passed`,
    `❌ ${run.failedTests.length} failed`,
    `⚠️ ${run.blockedTests.length} blocked`,
  ];
  const review = (run.needsReviewTests ?? []).length;
  if (review > 0) {
    parts.push(`⚠️ ${review} need review`);
  }
  if (run.skippedTests.length > 0) {
    parts.push(`⏭️ ${run.skippedTests.length} not scheduled`);
  }
  return parts.join(sep);
}

/** Header plus one row per test the run left out, with the backend's reason. */
export function buildSkippedRows(skipped: SkippedTest[]): SummaryTableRow[] {
  const header: SummaryTableRow = [
    { data: 'Test', header: true },
    { data: 'Platform', header: true },
    { data: 'Reason', header: true },
  ];
  return [
    header,
    ...skipped.map((test): SummaryTableRow => {
      const label = reasonLabel(test.reason);
      const reason = test.detail ? `${label}: ${test.detail}` : label;
      return [
        escapeHtml(test.title || test.testId || '(untitled)'),
        escapeHtml(test.platform || '-'),
        escapeHtml(reason),
      ];
    }),
  ];
}

/**
 * Failed and blocked tests are listed first so they're seen immediately, then
 * the ones that need review, then the passes.
 */
export function buildRows(run: RunStatus): SummaryTableRow[] {
  const header: SummaryTableRow = [
    { data: 'Status', header: true },
    { data: 'Test', header: true },
    { data: 'Recording', header: true },
  ];

  const rows: SummaryTableRow[] = [header];
  for (const t of run.failedTests) rows.push(row('❌', t));
  for (const t of run.blockedTests) rows.push(row('⚠️', t));
  for (const t of run.needsReviewTests ?? []) rows.push(row('⚠️', t));
  for (const t of run.succeededTests) rows.push(row('✅', t));
  return rows;
}

function row(icon: string, test: TestResult): SummaryTableRow {
  const title = escapeHtml(test.title || test.id || '(untitled)');
  const link = test.recording
    ? `<a href="${escapeHtml(test.recording)}">recording</a>`
    : '—';
  return [icon, title, link];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
