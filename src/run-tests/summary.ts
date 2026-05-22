import * as core from '@actions/core';
import { SummaryTableRow } from '@actions/core/lib/summary';
import { formatDuration } from '../lib/format';
import { RunStatus, TestResult } from '../lib/types';

const APP_BASE_URL = 'https://app.mobileboost.io';

/**
 * Suite-level dashboard URL. The API only returns per-test recording URLs of
 * the form /recording/{suiteId}/runs/{runId}; the suite page is the prefix.
 */
export function buildRunUrl(runId: string): string {
  return `${APP_BASE_URL}/recording/${runId}`;
}

export interface RunSummaryOptions {
  durationMs: number;
  runUrl: string;
  cancelled: boolean;
}

export async function writeRunSummary(
  run: RunStatus,
  opts: RunSummaryOptions,
): Promise<void> {
  const passed = run.succeededTests.length;
  const failed = run.failedTests.length;
  const blocked = run.blockedTests.length;

  const aggregate = `✅ ${passed} passed&nbsp;&nbsp;&nbsp;❌ ${failed} failed&nbsp;&nbsp;&nbsp;⚠️ ${blocked} blocked`;

  let summary = core.summary
    .addHeading('MobileBoost — Test Run', 2)
    .addRaw(aggregate, true)
    .addEOL();

  if (opts.cancelled) {
    summary = summary.addRaw('> **Run was cancelled.**', true).addEOL();
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

  await summary.write();
}

/** Failed and blocked tests are listed first so they're seen immediately. */
function buildRows(run: RunStatus): SummaryTableRow[] {
  const header: SummaryTableRow = [
    { data: 'Status', header: true },
    { data: 'Test', header: true },
    { data: 'Recording', header: true },
  ];

  const rows: SummaryTableRow[] = [header];
  for (const t of run.failedTests) rows.push(row('❌', t));
  for (const t of run.blockedTests) rows.push(row('⚠️', t));
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
