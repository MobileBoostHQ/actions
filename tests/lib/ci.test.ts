import { collectGitHubCi } from '../../src/lib/ci';

describe('collectGitHubCi', () => {
  it('returns undefined when not in GitHub Actions', () => {
    expect(collectGitHubCi({})).toBeUndefined();
    expect(collectGitHubCi({ GITHUB_ACTIONS: 'false' })).toBeUndefined();
  });

  it('captures push-event info from env', () => {
    const info = collectGitHubCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'abc123def4567890',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_NAME: 'main',
      GITHUB_REF: 'refs/heads/main',
    });
    expect(info).toEqual({
      commitSha: 'abc123def4567890',
      branch: 'main',
      repo: 'owner/repo',
      event: 'push',
    });
  });

  it('prefers GITHUB_HEAD_REF and extracts prNumber on pull_request', () => {
    const info = collectGitHubCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'mergecommitsha',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_HEAD_REF: 'feature/x',
      GITHUB_REF_NAME: '42/merge',
      GITHUB_REF: 'refs/pull/42/merge',
    });
    expect(info).toEqual({
      commitSha: 'mergecommitsha',
      branch: 'feature/x',
      repo: 'owner/repo',
      event: 'pull_request',
      prNumber: 42,
    });
  });

  it('omits prNumber for non-PR events', () => {
    const info = collectGitHubCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 's',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF_NAME: 'main',
      GITHUB_REF: 'refs/heads/main',
    });
    expect(info?.prNumber).toBeUndefined();
  });
});
