import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBuildPath } from '../../src/lib/files';
import { InvalidInputError } from '../../src/lib/errors';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-files-test-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function touch(name: string, content = 'x'): string {
  const p = path.join(workDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('resolveBuildPath', () => {
  it('accepts a .zip file', async () => {
    const p = touch('app.zip');
    const res = await resolveBuildPath(p);
    expect(res.filePath).toBe(p);
    expect(res.zippedFromDir).toBe(false);
    expect(res.sizeBytes).toBeGreaterThan(0);
  });

  it('accepts a .apk file (case-insensitive)', async () => {
    const p = touch('app.APK');
    const res = await resolveBuildPath(p);
    expect(res.filePath).toBe(p);
  });

  it('accepts an .ipa file', async () => {
    // An iOS build for a physical device has to be an .ipa, and this action
    // used to be the one place that refused it - so people zipped it instead.
    const p = touch('Kleinanzeigen-2026.38.0-sandbox.ipa');
    const res = await resolveBuildPath(p);
    expect(res.filePath).toBe(p);
    expect(res.zippedFromDir).toBe(false);
  });

  it('accepts an .ipa file (case-insensitive)', async () => {
    const p = touch('App.IPA');
    const res = await resolveBuildPath(p);
    expect(res.filePath).toBe(p);
  });

  it('accepts a .tar.gz file', async () => {
    const p = touch('sim-build.tar.gz');
    const res = await resolveBuildPath(p);
    expect(res.filePath).toBe(p);
  });

  it('rejects .tgz, which the API does not take', async () => {
    // The API matches on the literal '.tar.gz', so accepting .tgz here would
    // only move the rejection to the upload, where it is far less obvious.
    const p = touch('sim-build.tgz');
    await expect(resolveBuildPath(p)).rejects.toThrow(InvalidInputError);
  });

  it('rejects an unsupported extension', async () => {
    const p = touch('app.txt');
    await expect(resolveBuildPath(p)).rejects.toThrow(InvalidInputError);
    await expect(resolveBuildPath(p)).rejects.toThrow(/Expected one of/);
  });

  it('names every accepted extension when it rejects one', async () => {
    // The message is the whole answer a user gets, so it has to be current:
    // it used to say ".zip, .apk" and send iOS users off to zip their .ipa.
    const p = touch('app.txt');
    await expect(resolveBuildPath(p)).rejects.toThrow(
      /\.zip, \.apk, \.ipa, \.tar\.gz/,
    );
  });

  it('rejects empty input', async () => {
    await expect(resolveBuildPath('   ')).rejects.toThrow(/empty/);
  });

  it('throws when a glob matches nothing', async () => {
    await expect(
      resolveBuildPath(path.join(workDir, '*.apk')),
    ).rejects.toThrow(/No file or directory matched/);
  });

  it('picks the first match for a glob', async () => {
    touch('b.apk');
    touch('a.apk');
    const res = await resolveBuildPath(path.join(workDir, '*.apk'));
    expect(path.basename(res.filePath)).toBe('a.apk');
  });

  it('zips a directory', async () => {
    const dir = path.join(workDir, 'bundle');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'inner.txt'), 'hello');
    const res = await resolveBuildPath(dir);
    expect(res.zippedFromDir).toBe(true);
    expect(res.filePath.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(res.filePath)).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(0);
  });
});
