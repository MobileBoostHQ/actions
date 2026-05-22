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

  it('rejects an unsupported extension', async () => {
    const p = touch('app.txt');
    await expect(resolveBuildPath(p)).rejects.toThrow(InvalidInputError);
    await expect(resolveBuildPath(p)).rejects.toThrow(/Expected one of/);
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
