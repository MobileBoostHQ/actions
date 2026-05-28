// Auto-collected source-control context for builds uploaded from CI.
// The backend stores this as a top-level `ci` field on the upload doc, so the
// dashboard can answer questions like "which build came from this branch/PR?".

export interface CiInfo {
  commitSha: string;
  branch: string;
  repo: string;
  event: string;
  prNumber?: number;
}

/**
 * Returns a CI info payload when running inside GitHub Actions, or `undefined`
 * otherwise (local runs, the e2e harness, other CI providers).
 *
 * Note: on `pull_request` events `GITHUB_SHA` is GitHub's synthetic merge
 * commit, not the PR head. That's fine — it identifies the exact tree that
 * was built. The PR's head ref is captured separately in `branch`.
 */
export function collectGitHubCi(env: NodeJS.ProcessEnv = process.env): CiInfo | undefined {
  if (env.GITHUB_ACTIONS !== 'true') return undefined;

  const commitSha = env.GITHUB_SHA ?? '';
  const repo = env.GITHUB_REPOSITORY ?? '';
  const event = env.GITHUB_EVENT_NAME ?? '';
  // For PRs, GITHUB_REF_NAME is "<N>/merge"; the source branch lives in
  // GITHUB_HEAD_REF. For push/dispatch, GITHUB_HEAD_REF is empty.
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '';

  if (!commitSha && !repo && !branch) return undefined;

  const info: CiInfo = { commitSha, branch, repo, event };

  const prNumber = parsePrNumber(env.GITHUB_REF, event);
  if (prNumber !== undefined) info.prNumber = prNumber;

  return info;
}

function parsePrNumber(ref: string | undefined, event: string): number | undefined {
  if (event !== 'pull_request' && event !== 'pull_request_target') return undefined;
  if (!ref) return undefined;
  const m = /^refs\/pull\/(\d+)\//.exec(ref);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}
