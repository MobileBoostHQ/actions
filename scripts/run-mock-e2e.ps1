. (Join-Path $PSScriptRoot 'fake-github-pr.ps1')
$env:API_URL = 'http://127.0.0.1:9999'
$env:MODE = 'upload'
$env:BUILD_PATH = (Join-Path $PSScriptRoot 'dummy.zip')
# Mock server doesn't validate the key; just needs the env to be set so the harness runs.
$env:MOBILEBOOST_API_KEY = 'mb_live_fake_for_mock'
$env:MOBILEBOOST_ORG_ID = 'testing'
npm run e2e:local
