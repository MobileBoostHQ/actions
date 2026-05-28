#!/usr/bin/env node
// Tiny stand-in for /uploadBuild/. Receives a multipart upload, prints the
// non-file form fields (especially `ci`), and returns a fake buildId. Used to
// verify the action collects + sends CI info correctly, without touching the
// real backend or Firestore.
//
//   node scripts/mock-upload-server.mjs
//
// Then in another terminal:
//   $env:API_URL = "http://127.0.0.1:9999"
//   $env:MODE = "upload"
//   $env:BUILD_PATH = "C:\path\to\any-tiny.zip"
//   $env:GITHUB_ACTIONS = "true"; ...  # see scripts/fake-github-pr.ps1
//   npm run e2e:local

import * as http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 9999);

function parseMultipart(body, contentType) {
  // Split on the boundary declared in the request's Content-Type header.
  const bm = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentType || '');
  if (!bm) return {};
  const boundary = bm[1] || bm[2];
  const sep = `--${boundary}`;
  const result = {};
  // Drop the preamble and the closing "--boundary--" tail; what's left is one
  // entry per field.
  const parts = body.split(sep).slice(1, -1);
  for (const raw of parts) {
    const trimmed = raw.startsWith('\r\n') ? raw.slice(2) : raw;
    const headersEnd = trimmed.indexOf('\r\n\r\n');
    if (headersEnd === -1) continue;
    const headers = trimmed.slice(0, headersEnd);
    let value = trimmed.slice(headersEnd + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    if (!nameMatch) continue;
    const isFile = /filename="/.test(headers);
    result[nameMatch[1]] = isFile ? `<file: ${value.length} bytes>` : value;
  }
  return result;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/uploadBuild')) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('binary');
    const fields = parseMultipart(body, req.headers['content-type']);

    console.log('\n=== /uploadBuild/ received ===');
    console.log(`  size            : ${body.length} bytes`);
    console.log(`  authorization   : ${(req.headers.authorization || '').slice(0, 14)}…`);

    for (const field of ['build', 'organisation_key', 'platform', 'metadata', 'ci']) {
      const val = fields[field];
      if (val === undefined) {
        console.log(`  ${field.padEnd(16)}: <absent>`);
      } else if (field === 'ci' || field === 'metadata') {
        try {
          console.log(`  ${field.padEnd(16)}:`, JSON.parse(val));
        } catch {
          console.log(`  ${field.padEnd(16)}: ${val} (not JSON)`);
        }
      } else {
        console.log(`  ${field.padEnd(16)}: ${val}`);
      }
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        buildId: 'mock_build_id_001',
        app_link: 'http://mock/build/mock_build_id_001',
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock upload server listening on http://127.0.0.1:${PORT}/uploadBuild/`);
});
