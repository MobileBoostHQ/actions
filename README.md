# MobileBoost GitHub Actions

Run your [MobileBoost](https://mobileboost.io) mobile UI tests straight from CI.
This repo ships three composable actions:

- **`upload-build`** — upload an iOS/Android build (`.zip` or `.apk`) and get back a `build-id`.
- **`run-tests`** — trigger a test run against an uploaded build, optionally wait for it, and surface pass/fail.
- **`setup-local-tunnel`** — open a MobileBoost Local tunnel so the app under test can reach services inside your network, and close it again however the job ends.

They are intentionally separate so you can upload once and fan out into multiple
test runs, or run tests against a build you uploaded in an earlier job.

---

## Prerequisites

1. A MobileBoost account and an **API key** (`mb_live_…`). Store it as a repository
   **secret**, e.g. `MOBILEBOOST_API_KEY`.
2. Your **organisation ID**. Store it as a repository **variable**, e.g.
   `MOBILEBOOST_ORG_ID` (it isn't secret, but a variable keeps workflows tidy).

> Settings → Secrets and variables → Actions → _Secrets_ (for the key) /
> _Variables_ (for the org ID).

---

## Quick start

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: MobileBoostHQ/actions/upload-build@v1
        id: upload
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
          build-path: app/build/outputs/apk/release/*.apk

      - uses: MobileBoostHQ/actions/run-tests@v1
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
          build-id: ${{ steps.upload.outputs.build-id }}
          tags: smoke,critical
          async: false
```

By default `run-tests` triggers the run and returns immediately (`async: true`).
Set `async: false`, as above, to make the step wait for the run to finish and
**fail the job** if any test fails or is blocked — a result table is then
written to the job summary.

---

## `upload-build`

Uploads a build artifact and emits its `build-id` and dashboard link.

### Inputs

| Input             | Required | Default                      | Description                                                                                     |
| ----------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `api-key`         | yes      | —                            | MobileBoost API key (`mb_live_…`). Use a secret.                                                |
| `organisation-id` | yes      | —                            | Your MobileBoost organisation ID.                                                               |
| `build-path`      | yes      | —                            | Path to a `.zip`/`.apk` file, a directory (zipped automatically), or a glob (first match used). |
| `metadata`        | no       | —                            | Metadata as a JSON object string (the API parses it as JSON).                                   |
| `api-url`         | no       | `https://api.mobileboost.io` | Override the API base URL.                                                                      |

### Outputs

| Output     | Description                                               |
| ---------- | --------------------------------------------------------- |
| `build-id` | The `buildId` of the uploaded build. Pass to `run-tests`. |
| `app-link` | Dashboard URL for the uploaded build.                     |

### Notes

- **Accepted files:** `.zip` and `.apk` only in v1.
- **Directories** are zipped (deflate level 6) before upload.
- **Globs** matching more than one file log a warning and use the first sorted match.
- Builds **above 500 MB** log a warning (the upload still proceeds).

---

## `run-tests`

Triggers a test run against an uploaded build and, with `async: false`, waits for it.

### Inputs

| Input                      | Required | Default                      | Description                                                                                                                 |
| -------------------------- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `api-key`                  | yes      | —                            | MobileBoost API key. Use a secret.                                                                                          |
| `organisation-id`          | yes      | —                            | Your MobileBoost organisation ID.                                                                                           |
| `build-id`                 | yes      | —                            | Build ID from `upload-build`.                                                                                               |
| `mode`                     | no       | `gpt-driver`                 | `gpt-driver` for AI suites authored in the dashboard, `autotest` for pytest files from your test repo. See [Modes](#modes). |
| `test-ids`                 | no\*     | —                            | Comma-separated test IDs.                                                                                                   |
| `tags`                     | no\*     | —                            | Comma-separated tags; tests matching **any** tag run.                                                                       |
| `tags-query`               | no\*     | —                            | Tag query expression for advanced filtering. Not supported with `mode: autotest`.                                           |
| `tests-repo`               | no       | org default                  | `autotest` only. Git https URL of the repo holding the pytest files.                                                        |
| `use-physical-device`      | no       | org default                  | `autotest` only. Run on physical devices instead of simulators/emulators.                                                   |
| `tunnel-name`              | no       | —                            | `autotest` only. MobileBoost Local tunnel the app's traffic runs through. Take it from `setup-local-tunnel`.                |
| `iterations`               | no       | —                            | `gpt-driver` only. Number of suite runs to create (see caveat below).                                                       |
| `launch-params`            | no       | —                            | `gpt-driver` only. JSON object of launch parameters.                                                                        |
| `device-provider-settings` | no       | —                            | `gpt-driver` only. JSON object of device provider settings.                                                                 |
| `test-inputs`              | no       | —                            | `gpt-driver` only. JSON object of test inputs.                                                                              |
| `device-configs`           | no       | —                            | `gpt-driver` only. JSON **array** of device configurations.                                                                 |
| `metadata`                 | no       | —                            | `gpt-driver` only. JSON object attached to the run.                                                                         |
| `async`                    | no       | `true`                       | If `true` (the default), return immediately after triggering. Set `false` to poll until completion.                         |
| `timeout-minutes`          | no       | `180`                        | Max time to wait in sync mode.                                                                                              |
| `fail-on-test-failure`     | no       | `true`                       | Fail the action when any test fails or is blocked.                                                                          |
| `api-url`                  | no       | `https://api.mobileboost.io` | Override the API base URL.                                                                                                  |

\* At least one of `test-ids`, `tags`, or `tags-query` is required.

### Modes

**`gpt-driver` (default)** — the AI-driven suites you author in the dashboard.

**`autotest`** — pytest files from your organisation's test repo, executed on
real devices, with an AI agent that self-heals broken selectors and flags
changes it judges product-impacting rather than papering over them.

Autotest runs post their results **straight back to the pull request** the build
came from. That works because `upload-build` stamps every CI upload with the
commit, branch and PR number, so the run can be traced back to the PR without
you wiring anything up. Requirements:

1. **`enableAutotestPrComments` is set to `true` on your organisation.** This is
   **off by default** — MobileBoost writes to your repository, so it stays off
   until you deliberately turn it on. Ask support to enable it.
2. The build was uploaded by `upload-build` running in GitHub Actions.
3. The [MobileBoost GitHub App](https://github.com/apps/mobileboost-test-agent)
   is installed on the repository.
4. The commit is on an open PR (or the run was triggered from a `pull_request`
   event).

Autotest runs work fine without any of this — you just get results in the job
summary and the dashboard instead of on the PR.

The comment is _sticky_ — one comment per PR, rewritten on each new build,
rather than a new comment per push. It leads with why each test failed in plain
language, folds the pytest traceback into a `<details>` block, and calls out any
test the agent auto-healed.

### Outputs

| Output    | Description                               |
| --------- | ----------------------------------------- |
| `run-id`  | The ID of the triggered run.              |
| `passed`  | Number of passed tests (sync mode only).  |
| `failed`  | Number of failed tests (sync mode only).  |
| `blocked` | Number of blocked tests (sync mode only). |

### Behavior

- **Async mode (`async: true`, the default):** triggers the run, sets `run-id`,
  and exits 0 immediately — useful when a later job inspects the run. Note that
  `timeout-minutes` and `fail-on-test-failure` only apply in sync mode, so in
  async mode the job does not wait for or gate on test results.
- **Sync mode (`async: false`):** polls until the run is `completed` (or
  `cancelled`), writes a result table to the job summary, sets the
  `passed`/`failed`/`blocked` outputs, and fails the job when
  `fail-on-test-failure` is `true` and anything failed or was blocked. A
  `cancelled` run always fails the job.
- **`iterations` caveat:** the API creates one suite run per iteration. This
  action **tracks only the first** run and warns if more were created. Leave
  `iterations` unset (the default) for a single tracked run.

### Examples

**Trigger only, don't wait (the default):**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    tags: smoke
```

**Autotest on a pull request, with results posted back to the PR:**

```yaml
- uses: MobileBoostHQ/actions/upload-build@v1
  id: upload
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-path: app/build/outputs/apk/debug/app-debug.apk

- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    mode: autotest
    tags: smoke
    async: false
```

No `permissions:` block and no `GITHUB_TOKEN` needed — the comment is posted by
the MobileBoost GitHub App, which also means it works on pull requests from
forks, where the workflow token is read-only.

**Wait for completion with a custom timeout (sync mode):**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    test-ids: t_abc123,t_def456
    async: false
    timeout-minutes: 30
```

**Wait, but don't fail the job on test failures (report only):**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    tags: regression
    async: false
    fail-on-test-failure: false
```

**Matrix over platforms:** (the platform is inferred from each build)

```yaml
strategy:
  matrix:
    platform: [ios, android]
steps:
  - uses: MobileBoostHQ/actions/upload-build@v1
    id: upload
    with:
      api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
      organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
      build-path: build/${{ matrix.platform }}/*
  - uses: MobileBoostHQ/actions/run-tests@v1
    with:
      api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
      organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
      build-id: ${{ steps.upload.outputs.build-id }}
      tags: smoke
```

---

## Trigger strategies

Both actions are ordinary workflow steps, so they run under any trigger — only
the `on:` block changes. The job below is the same in every case:

```yaml
jobs:
  mobile-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: MobileBoostHQ/actions/upload-build@v1
        id: upload
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
          build-path: app/build/outputs/apk/release/*.apk
      - uses: MobileBoostHQ/actions/run-tests@v1
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
          build-id: ${{ steps.upload.outputs.build-id }}
          tags: smoke
```

Pair it with whichever trigger fits:

### On release or tag

```yaml
on:
  push:
    tags:
      - 'v*.*.*' # v1.0.0, v20.15.10, …
  release:
    types: [published]
```

Best for **production builds** — stable and versioned.

### Scheduled (nightly / weekly)

```yaml
on:
  schedule:
    - cron: '0 3 * * *' # daily at 03:00 UTC
    # - cron: '0 6 * * 1'  # weekly, Mondays at 06:00 UTC
```

Best for **tracking regressions** over time.

### Manual

```yaml
on:
  workflow_dispatch:
    inputs:
      tags:
        description: 'Tags to run'
        required: false
        default: 'smoke'
```

Then read the input in the run-tests step (`tags: ${{ inputs.tags }}`). Best for
**ad-hoc runs** you control from the Actions tab.

### On merged pull request

```yaml
on:
  pull_request:
    types: [closed]

jobs:
  mobile-tests:
    if: github.event.pull_request.merged == true # skip PRs closed without merging
    runs-on: ubuntu-latest
    steps:
      # …upload-build + run-tests as above…
```

Best for **validating a build before it lands** on the default branch.

---

## Enterprise / advanced

- **Proxy:** both actions honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` from
  the environment (via `@actions/http-client`). Set them as job/step `env`.
- **Custom CA (TLS-inspecting proxies, e.g. Netskope):** point
  `NODE_EXTRA_CA_CERTS` at your CA bundle. Node respects it natively.
  ```yaml
  - uses: MobileBoostHQ/actions/upload-build@v1
    env:
      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/corp-ca.pem
    with: { ... }
  ```
- **Self-hosted runners:** use a recent runner version. The action runs on the
  runner's **bundled** Node 24 (not the machine's system Node), so keep the
  runner application up to date; no separate Node install is required.
- **`api-url`:** override the base URL for staging or a private deployment.

---

## Troubleshooting

| Symptom                                   | Likely cause                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Invalid API key (401)`                   | The `api-key` secret is missing/wrong, or not an `mb_live_…` key.                                    |
| `No file or directory matched build-path` | The glob/path didn't resolve on the runner. Check the working directory and that the build step ran. |
| `Unsupported build file`                  | Only `.zip` and `.apk` are accepted in v1.                                                           |
| Run `did not finish within the timeout`   | Increase `timeout-minutes`, or use `async: true`. The run keeps going on MobileBoost.                |
| Job fails with `N failed, M blocked`      | Tests failed/were blocked. Open the linked dashboard run to inspect recordings.                      |

Enable verbose logs by setting the repo secret/variable `ACTIONS_STEP_DEBUG` to
`true`.

---

## License

[MIT](./LICENSE)

---

## `setup-local-tunnel`

Opens a [MobileBoost Local](https://docs.mobileboost.io/test-agent/local-testing)
tunnel for the job, so the app under test can reach `staging.acme.internal`,
`10.0.5.12:8443`, or anything else that only exists inside your network. The
tunnel is closed again in a post step that runs even when the job fails or is
cancelled.

```yaml
jobs:
  e2e:
    # The tunnel has to run somewhere that can already reach your services, so
    # this belongs on a self-hosted runner inside your network. On a
    # GitHub-hosted runner the tunnel connects and then carries nothing.
    runs-on: [self-hosted, internal-network]
    steps:
      - uses: MobileBoostHQ/actions/setup-local-tunnel@v1
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          only-hosts: '*.acme.internal,10.0.0.0/8'

      - uses: MobileBoostHQ/actions/run-tests@v1
        with:
          api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
          organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
          build-id: ${{ steps.upload.outputs.build-id }}
          mode: autotest
          tags: smoke
          tunnel-name: ${{ steps.tunnel.outputs.tunnel-name }}
```

Tunnels require `mode: autotest` — the AI SDET path, which runs generated test
code on MobileBoost devices. The default `gpt-driver` path runs on a
third-party device cloud that a tunnel cannot reach, and passing `tunnel-name`
there fails the step rather than silently running without it.

Each job gets its own tunnel name, derived from the run id, attempt and job, so
parallel and matrix jobs cannot collide. Pass `tunnel-name` only when several
jobs must deliberately share one.

### Inputs

| Input            | Required | Description                                                                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `api-key`        | Yes      | MobileBoost API key. A key scoped to `tunnel:connect` is enough.                                                                    |
| `only-hosts`     | No       | Comma-separated hosts the tunnel may reach. Strongly recommended: anything not listed is refused on the runner rather than carried. |
| `exclude-hosts`  | No       | Hosts it may never reach. Wins over `only-hosts`.                                                                                   |
| `tunnel-name`    | No       | Override the generated per-job name.                                                                                                |
| `version`        | No       | Pin a binary version, e.g. `v0.2.3`. Defaults to the latest release.                                                                |
| `wait-for-ready` | No       | How long to wait for the tunnel to become usable. Defaults to `60s`.                                                                |

### Outputs

| Output        | Description                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `tunnel-name` | The name to pass as `tunnelName` when triggering a run. Also exported as `MOBILEBOOST_TUNNEL_NAME`. |

The step waits until the tunnel is actually usable before finishing, so tests
never start against one that is not up yet.
