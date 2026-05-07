import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('prefers public when the target project has a public directory', async () => {
    const sourceRoot = await tempDir();
    const targetProjectPath = await tempDir();
    await mkdir(path.join(targetProjectPath, 'public'));
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
    expect(first.destinationPath).toBe(path.join(targetProjectPath, 'public', 'design'));
    expect(second.destinationPath).toBe(path.join(targetProjectPath, 'public', 'design-2'));
    await expect(readFile(path.join(targetProjectPath, 'public', 'design', 'index.html'), 'utf8'))
      .resolves.toBe('<h1>Hello</h1>');
    await expect(readFile(path.join(targetProjectPath, 'public', 'design', 'assets', 'style.css'), 'utf8'))
      .resolves.toBe('body { color: red; }');
  });

  it('creates an index with links to uploaded HTML files when index.html is missing', async () => {
    const sourceRoot = await tempDir();
    const targetProjectPath = await tempDir();
    await mkdir(path.join(sourceRoot, 'pages'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'home.html'), '<h1>Home</h1>');
    await writeFile(path.join(sourceRoot, 'pages', 'about us.html'), '<h1>About</h1>');
    await writeFile(path.join(sourceRoot, 'style.css'), 'body { color: red; }');

    const result = await uploadDesignAssetsToProject({
      targetProject: { name: 'target', path: targetProjectPath },
      sourceRoot,
      entries: [
        { relPath: 'home.html', fullPath: path.join(sourceRoot, 'home.html') },
        { relPath: 'pages/about us.html', fullPath: path.join(sourceRoot, 'pages', 'about us.html') },
        { relPath: 'assets/style.css', fullPath: path.join(sourceRoot, 'style.css') },
      ],
    });

    expect(result.fileCount).toBe(4);
    const index = await readFile(path.join(targetProjectPath, 'design', 'index.html'), 'utf8');
    expect(index).toContain('Design Assets');
    expect(index).toContain('<a href="home.html">home.html</a>');
    expect(index).toContain('<a href="pages/about%20us.html">pages/about us.html</a>');
    expect(index).not.toContain('assets/style.css');
  });

  it('does not overwrite an uploaded root index.html', async () => {
    const sourceRoot = await tempDir();
    const targetProjectPath = await tempDir();
    await writeFile(path.join(sourceRoot, 'index.html'), '<h1>Provided</h1>');
    await writeFile(path.join(sourceRoot, 'page.html'), '<h1>Page</h1>');

    const result = await uploadDesignAssetsToProject({
      targetProject: { name: 'target', path: targetProjectPath },
      sourceRoot,
      entries: [
        { relPath: 'index.html', fullPath: path.join(sourceRoot, 'index.html') },
        { relPath: 'page.html', fullPath: path.join(sourceRoot, 'page.html') },
      ],
    });

    expect(result.fileCount).toBe(2);
    await expect(readFile(path.join(targetProjectPath, 'design', 'index.html'), 'utf8'))
      .resolves.toBe('<h1>Provided</h1>');
  });
});
