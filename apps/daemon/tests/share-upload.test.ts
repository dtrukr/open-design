import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { uploadDesignAssetsToProject } from '../src/share-upload.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-share-upload-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('share upload', () => {
  it('copies files unarchived into the first available design suffix', async () => {
    const sourceRoot = await tempDir();
    const targetProjectPath = await tempDir();
    await writeFile(path.join(sourceRoot, 'index.html'), '<h1>Hello</h1>');
    await writeFile(path.join(sourceRoot, 'style.css'), 'body { color: red; }');

    const first = await uploadDesignAssetsToProject({
      targetProject: { name: 'target', path: targetProjectPath },
      sourceRoot,
      entries: [
        { relPath: 'index.html', fullPath: path.join(sourceRoot, 'index.html') },
        { relPath: 'assets/style.css', fullPath: path.join(sourceRoot, 'style.css') },
      ],
    });
    const second = await uploadDesignAssetsToProject({
      targetProject: { name: 'target', path: targetProjectPath },
      sourceRoot,
      entries: [
        { relPath: 'index.html', fullPath: path.join(sourceRoot, 'index.html') },
      ],
    });

    expect(first.directoryName).toBe('design');
    expect(second.directoryName).toBe('design-2');
    await expect(readFile(path.join(targetProjectPath, 'design', 'index.html'), 'utf8'))
      .resolves.toBe('<h1>Hello</h1>');
    await expect(readFile(path.join(targetProjectPath, 'design', 'assets', 'style.css'), 'utf8'))
      .resolves.toBe('body { color: red; }');
  });
});
