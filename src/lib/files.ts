import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as glob from '@actions/glob';
import archiver from 'archiver';
import { InvalidInputError } from './errors';
import { logger } from './logger';

// v1 scope: the action accepts only .zip and .apk (see README non-goals).
// The backend additionally accepts .ipa/.tar.gz, but we keep the action's
// surface deliberately narrow until those are formally supported.
const ALLOWED_EXTENSIONS = ['.zip', '.apk'];

export interface ResolvedBuild {
  /** Absolute path to the file that should be uploaded. */
  filePath: string;
  sizeBytes: number;
  /** True when filePath is a freshly zipped directory (a temp file). */
  zippedFromDir: boolean;
}

/**
 * Resolves the `build-path` input to a concrete uploadable file:
 *   - a glob  -> first match (warns if more than one),
 *   - a directory -> zipped to a temp .zip,
 *   - a file -> validated against the allowed extensions.
 * Throws InvalidInputError with an actionable message otherwise.
 */
export async function resolveBuildPath(input: string): Promise<ResolvedBuild> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidInputError('`build-path` is empty.');
  }

  // A literal existing path skips glob handling; otherwise treat as a pattern.
  const target = fs.existsSync(trimmed)
    ? trimmed
    : await resolveGlob(trimmed);

  const stat = fs.statSync(target);

  if (stat.isDirectory()) {
    const zipped = await zipDirectory(target);
    return {
      filePath: zipped,
      sizeBytes: fs.statSync(zipped).size,
      zippedFromDir: true,
    };
  }

  validateExtension(target);
  return { filePath: target, sizeBytes: stat.size, zippedFromDir: false };
}

async function resolveGlob(pattern: string): Promise<string> {
  const globber = await glob.create(pattern, { matchDirectories: true });
  const matches = (await globber.glob()).sort((a, b) => a.localeCompare(b));

  if (matches.length === 0) {
    throw new InvalidInputError(
      `No file or directory matched \`build-path\`: ${pattern}`,
    );
  }
  if (matches.length > 1) {
    logger.warning(
      `\`build-path\` matched ${matches.length} paths; using the first: ${matches[0]}. ` +
        `Matches: ${matches.join(', ')}`,
    );
  }
  // matches[0] is defined: length checked above (noUncheckedIndexedAccess).
  return matches[0] as string;
}

function validateExtension(filePath: string): void {
  const lower = filePath.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new InvalidInputError(
      `Unsupported build file: ${path.basename(filePath)}. ` +
        `Expected one of: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    );
  }
}

function zipDirectory(dir: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-build-'));
  const zipPath = path.join(tmpDir, `${path.basename(dir) || 'build'}.zip`);
  logger.info(`Zipping directory ${dir} -> ${zipPath}`);

  return new Promise<string>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(zipPath));
    archive.on('warning', (err) => logger.warning(`archiver: ${err.message}`));
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    // `false` puts the directory's contents at the archive root. archiver does
    // not create __MACOSX/ entries, so the zip stays clean.
    archive.directory(dir, false);
    void archive.finalize();
  });
}
