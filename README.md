# MobileBoost GitHub Actions

Run your [MobileBoost](https://mobileboost.io) mobile UI tests straight from CI.
This repo ships two composable actions:

- **`upload-build`** — upload an iOS/Android build (`.zip` or `.apk`) and get back a `build-id`.
- **`run-tests`** — trigger a test run against an uploaded build, optionally wait for it, and surface pass/fail.

They are intentionally separate so you can upload once and fan out into multiple
test runs, or run tests against a build you uploaded in an earlier job.

---

## Prerequisites

1. A MobileBoost account and an **API key** (`mb_live_…`). Store it as a repository
   **secret**, e.g. `MOBILEBOOST_API_KEY`.
2. Your **organisation ID**. Store it as a repository **variable**, e.g.
   `MOBILEBOOST_ORG_ID` (it isn't secret, but a variable keeps workflows tidy).

> Settings → Secrets and variables → Actions → *Secrets* (for the key) /
> *Variables* (for the org ID).

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
```

The `run-tests` step waits for the run to finish and **fails the job** if any
test fails or is blocked. A result table is written to the job summary.

---

## `upload-build`

Uploads a build artifact and emits its `build-id` and dashboard link.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | — | MobileBoost API key (`mb_live_…`). Use a secret. |
| `organisation-id` | yes | — | Your MobileBoost organisation ID. |
| `build-path` | yes | — | Path to a `.zip`/`.apk` file, a directory (zipped automatically), or a glob (first match used). |
| `metadata` | no | — | Metadata as a JSON object string (the API parses it as JSON). |
| `api-url` | no | `https://api.mobileboost.io` | Override the API base URL. |

### Outputs

| Output | Description |
| --- | --- |
| `build-id` | The `buildId` of the uploaded build. Pass to `run-tests`. |
| `app-link` | Dashboard URL for the uploaded build. |

### Notes

- **Accepted files:** `.zip` and `.apk` only in v1.
- **Directories** are zipped (deflate level 6) before upload.
- **Globs** matching more than one file log a warning and use the first sorted match.
- Builds **above 500 MB** log a warning (the upload still proceeds).

---

## `run-tests`

Triggers a test run against an uploaded build and (by default) waits for it.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | — | MobileBoost API key. Use a secret. |
| `organisation-id` | yes | — | Your MobileBoost organisation ID. |
| `build-id` | yes | — | Build ID from `upload-build`. |
| `test-ids` | no* | — | Comma-separated test IDs. |
| `tags` | no* | — | Comma-separated tags; tests matching **any** tag run. |
| `tags-query` | no* | — | Tag query expression for advanced filtering. |
| `iterations` | no | — | Number of suite runs to create (see caveat below). |
| `launch-params` | no | — | JSON object of launch parameters. |
| `device-provider-settings` | no | — | JSON object of device provider settings. |
| `test-inputs` | no | — | JSON object of test inputs. |
| `device-configs` | no | — | JSON **array** of device configurations. |
| `metadata` | no | — | JSON object attached to the run. |
| `async` | no | `false` | If `true`, return immediately after triggering. |
| `timeout-minutes` | no | `60` | Max time to wait in sync mode. |
| `fail-on-test-failure` | no | `true` | Fail the action when any test fails or is blocked. |
| `api-url` | no | `https://api.mobileboost.io` | Override the API base URL. |

\* At least one of `test-ids`, `tags`, or `tags-query` is required.

### Outputs

| Output | Description |
| --- | --- |
| `run-id` | The ID of the triggered run. |
| `passed` | Number of passed tests (sync mode only). |
| `failed` | Number of failed tests (sync mode only). |
| `blocked` | Number of blocked tests (sync mode only). |

### Behavior

- **Sync mode (default):** polls until the run is `completed` (or `cancelled`),
  writes a result table to the job summary, sets the `passed`/`failed`/`blocked`
  outputs, and fails the job when `fail-on-test-failure` is `true` and anything
  failed or was blocked. A `cancelled` run always fails the job.
- **Async mode (`async: true`):** triggers the run, sets `run-id`, and exits 0
  immediately — useful when a later job inspects the run.
- **`iterations` caveat:** the API creates one suite run per iteration. This
  action **tracks only the first** run and warns if more were created. Leave
  `iterations` unset (the default) for a single tracked run.

### Examples

**iOS, specific tests, custom timeout:**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    test-ids: t_abc123,t_def456
    timeout-minutes: 30
```

**Trigger only, don't wait:**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    tags: smoke
    async: true
```

**Don't fail the job on test failures (report only):**

```yaml
- uses: MobileBoostHQ/actions/run-tests@v1
  with:
    api-key: ${{ secrets.MOBILEBOOST_API_KEY }}
    organisation-id: ${{ vars.MOBILEBOOST_ORG_ID }}
    build-id: ${{ steps.upload.outputs.build-id }}
    tags: regression
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

| Symptom | Likely cause |
| --- | --- |
| `Invalid API key (401)` | The `api-key` secret is missing/wrong, or not an `mb_live_…` key. |
| `No file or directory matched build-path` | The glob/path didn't resolve on the runner. Check the working directory and that the build step ran. |
| `Unsupported build file` | Only `.zip` and `.apk` are accepted in v1. |
| Run `did not finish within the timeout` | Increase `timeout-minutes`, or use `async: true`. The run keeps going on MobileBoost. |
| Job fails with `N failed, M blocked` | Tests failed/were blocked. Open the linked dashboard run to inspect recordings. |

Enable verbose logs by setting the repo secret/variable `ACTIONS_STEP_DEBUG` to
`true`.

---

## License

[MIT](./LICENSE)
