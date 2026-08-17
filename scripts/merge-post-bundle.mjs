// Fold the post-step bundle into the action's dist directory.
//
// ncc emits one entry point per invocation as index.js, and setup-local-tunnel
// has two: the main step and the post step that closes the tunnel. Building the
// post step straight into dist/ would overwrite the main one, so it goes to a
// scratch directory and the single file it produces is moved into place as
// post.js, which is what action.yml points at.

import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'setup-local-tunnel/dist';
const scratch = 'setup-local-tunnel/dist-post';

if (!existsSync(join(scratch, 'index.js'))) {
  console.error(`expected ${scratch}/index.js from ncc; did the build fail?`);
  process.exit(1);
}

renameSync(join(scratch, 'index.js'), join(dist, 'post.js'));

// Source maps are emitted next to the bundle and referenced by name, so the
// map has to be renamed with it or the reference dangles.
if (existsSync(join(scratch, 'index.js.map'))) {
  renameSync(join(scratch, 'index.js.map'), join(dist, 'post.js.map'));
}

// Any assets ncc pulled in belong beside the bundle that needs them.
for (const extra of ['licenses.txt']) {
  const from = join(scratch, extra);
  if (existsSync(from)) cpSync(from, join(dist, `post-${extra}`));
}

rmSync(scratch, { recursive: true, force: true });
console.log(`merged post bundle into ${dist}/post.js`);
