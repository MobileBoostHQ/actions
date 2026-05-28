# Dot-source this to simulate the env GitHub sets on a pull_request run:
#   . .\scripts\fake-github-pr.ps1
# Then run `npm run e2e:local` in the same shell.

$env:GITHUB_ACTIONS    = "true"
$env:GITHUB_SHA        = "abc1234567890deadbeefcafe1234567890abcdef"
$env:GITHUB_REPOSITORY = "MobileBoostHQ/example-app"
$env:GITHUB_EVENT_NAME = "pull_request"
$env:GITHUB_HEAD_REF   = "feature/ci-metadata"
$env:GITHUB_BASE_REF   = "main"
$env:GITHUB_REF        = "refs/pull/42/merge"
$env:GITHUB_REF_NAME   = "42/merge"

Write-Host "Set fake GitHub PR env (SHA=$($env:GITHUB_SHA.Substring(0,7)), branch=$env:GITHUB_HEAD_REF, PR=#42)"
