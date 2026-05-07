import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryProject } from './project-registry.js';

export interface ShareAssetEntry {
  relPath: string;
  fullPath: string;
}

export interface ShareUploadResult {
  directoryName: string;
  destinationPath: string;
  fileCount: number;
  uploadedAt: number;
}

const DESTINATION_BASE_NAME = 'design';

export async function uploadDesignAssetsToProject(input: {
  targetProject: RegistryProject;
  sourceRoot: string;
  entries: ShareAssetEntry[];
}): Promise<ShareUploadResult> {
  if (input.entries.length === 0) throw new Error('no files to upload');
  if (input.targetProject.ssh) {
    return uploadRemote(input.targetProject, input.sourceRoot, input.entries);
  }
  return uploadLocal(input.targetProject, input.entries);
}

async function uploadLocal(
  targetProject: RegistryProject,
  entries: ShareAssetEntry[],
): Promise<ShareUploadResult> {
  const destinationPath = await createLocalDestinationDir(targetProject.path);
  for (const entry of entries) {
    const target = path.resolve(destinationPath, entry.relPath);
    if (!target.startsWith(destinationPath + path.sep) && target !== destinationPath) {
      throw new Error(`asset path escapes destination: ${entry.relPath}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(entry.fullPath, target);
  }
  const createdIndex = await createLocalHtmlIndexIfMissing(destinationPath, entries);
  return {
    directoryName: path.basename(destinationPath),
    destinationPath,
    fileCount: entries.length + (createdIndex ? 1 : 0),
    uploadedAt: Date.now(),
  };
}

async function uploadRemote(
  targetProject: RegistryProject,
  sourceRoot: string,
  entries: ShareAssetEntry[],
): Promise<ShareUploadResult> {
  const destinationPath = await createRemoteDestinationDir(targetProject);
  await tarUpload(targetProject.ssh!, sourceRoot, destinationPath, entries);
  const createdIndex = await createRemoteHtmlIndexIfMissing(targetProject.ssh!, destinationPath, entries);
  return {
    directoryName: path.posix.basename(destinationPath),
    destinationPath,
    fileCount: entries.length + (createdIndex ? 1 : 0),
    uploadedAt: Date.now(),
  };
}

async function createLocalDestinationDir(projectPath: string): Promise<string> {
  const basePath = await resolveLocalDestinationBase(projectPath);
  for (let i = 1; i < 10_000; i += 1) {
    const name = i === 1 ? DESTINATION_BASE_NAME : `${DESTINATION_BASE_NAME}-${i}`;
    const destinationPath = path.join(basePath, name);
    try {
      await mkdir(destinationPath);
      return destinationPath;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
        const existing = await stat(destinationPath).catch(() => null);
        if (existing?.isDirectory()) continue;
      }
      throw err;
    }
  }
  throw new Error('could not allocate destination directory');
}

async function createRemoteDestinationDir(targetProject: RegistryProject): Promise<string> {
  const script = `
set -eu
project=${shellQuote(targetProject.path)}
if [ -d "$project/public" ]; then
  base="$project/public"
else
  base="$project"
fi
i=1
while [ "$i" -lt 10000 ]; do
  if [ "$i" -eq 1 ]; then
    name=${shellQuote(DESTINATION_BASE_NAME)}
  else
    name=${shellQuote(DESTINATION_BASE_NAME)}-"$i"
  fi
  dest="$base/$name"
  if mkdir "$dest" 2>/dev/null; then
    printf '%s\\n' "$dest"
    exit 0
  fi
  if [ ! -d "$dest" ]; then
    exit 1
  fi
  i=$((i + 1))
done
exit 1
`.trim();
  const { stdout } = await runProcess('ssh', [targetProject.ssh!, script], {
    timeoutMs: 30_000,
  });
  const destinationPath = stdout.trim().split(/\r?\n/).at(-1)?.trim();
  if (!destinationPath) throw new Error('remote destination directory was not returned');
  return destinationPath;
}

async function resolveLocalDestinationBase(projectPath: string): Promise<string> {
  const publicPath = path.join(projectPath, 'public');
  const publicStat = await stat(publicPath).catch(() => null);
  if (publicStat?.isDirectory()) return publicPath;
  return projectPath;
}

async function createLocalHtmlIndexIfMissing(
  destinationPath: string,
  entries: ShareAssetEntry[],
): Promise<boolean> {
  const indexPath = path.join(destinationPath, 'index.html');
  const existing = await stat(indexPath).catch(() => null);
  if (existing) return false;
  await writeFile(indexPath, renderHtmlIndex(entries), 'utf8');
  return true;
}

async function createRemoteHtmlIndexIfMissing(
  sshTarget: string,
  destinationPath: string,
  entries: ShareAssetEntry[],
): Promise<boolean> {
  const script = `
set -eu
index_path=${shellQuote(path.posix.join(destinationPath, 'index.html'))}
if [ -e "$index_path" ]; then
  printf 'exists\\n'
  exit 0
fi
cat > "$index_path"
printf 'created\\n'
`.trim();
  const { stdout } = await runProcess('ssh', [sshTarget, script], {
    timeoutMs: 30_000,
    input: renderHtmlIndex(entries),
  });
  return stdout.trim().split(/\r?\n/).at(-1)?.trim() === 'created';
}

function renderHtmlIndex(entries: ShareAssetEntry[]): string {
  const htmlFiles = entries
    .map((entry) => normalizeAssetRelPath(entry.relPath))
    .filter((relPath) => relPath && relPath.toLowerCase().endsWith('.html'))
    .filter((relPath) => relPath !== 'index.html')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const links = htmlFiles.length > 0
    ? htmlFiles.map((relPath) => `          <li><a href="${escapeHtmlAttribute(relativeHref(relPath))}">${escapeHtml(relPath)}</a></li>`).join('\n')
    : '          <li><span>No HTML files were included in this upload.</span></li>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Design Assets</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f4ef;
        color: #211f1b;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 48px 20px;
      }
      main {
        width: min(760px, 100%);
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(2rem, 5vw, 4rem);
        line-height: 0.95;
        letter-spacing: 0;
      }
      p {
        margin: 0 0 28px;
        color: #6f6a60;
        font-size: 1rem;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      a,
      span {
        display: block;
        border: 1px solid rgba(33, 31, 27, 0.16);
        border-radius: 8px;
        padding: 16px 18px;
        background: rgba(255, 255, 255, 0.62);
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      a:hover,
      a:focus-visible {
        border-color: rgba(33, 31, 27, 0.34);
        background: #fff;
        outline: none;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          background: #171512;
          color: #f3eee5;
        }
        p {
          color: #b6afa3;
        }
        a,
        span {
          border-color: rgba(243, 238, 229, 0.16);
          background: rgba(255, 255, 255, 0.06);
        }
        a:hover,
        a:focus-visible {
          border-color: rgba(243, 238, 229, 0.34);
          background: rgba(255, 255, 255, 0.1);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Design Assets</h1>
      <p>HTML files included in this upload.</p>
      <ul>
${links}
      </ul>
    </main>
  </body>
</html>
`;
}

function normalizeAssetRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function relativeHref(relPath: string): string {
  return relPath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

async function tarUpload(
  sshTarget: string,
  sourceRoot: string,
  destinationPath: string,
  entries: ShareAssetEntry[],
): Promise<void> {
  const relPaths = entries.map((entry) => entry.relPath);
  const tar = spawn('tar', ['-C', sourceRoot, '-cf', '-', '--', ...relPaths], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ssh = spawn('ssh', [sshTarget, `tar -C ${shellQuote(destinationPath)} -xf -`], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  tar.stdout.pipe(ssh.stdin);

  let tarStderr = '';
  let sshStderr = '';
  tar.stderr.setEncoding('utf8');
  ssh.stderr.setEncoding('utf8');
  tar.stderr.on('data', (chunk) => {
    tarStderr += String(chunk);
  });
  ssh.stderr.on('data', (chunk) => {
    sshStderr += String(chunk);
  });

  const [tarCode, sshCode] = await Promise.all([
    waitForExit(tar),
    waitForExit(ssh),
  ]);
  if (tarCode !== 0) throw new Error(`tar upload failed: ${tarStderr.trim() || `exit ${tarCode}`}`);
  if (sshCode !== 0) throw new Error(`ssh upload failed: ${sshStderr.trim() || `exit ${sshCode}`}`);
}

async function runProcess(
  command: string,
  args: string[],
  opts: { timeoutMs: number; input?: string },
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, args, { stdio: [opts.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
  let stdout = '';
  let stderr = '';
  if (opts.input != null && child.stdin) {
    child.stdin.end(opts.input);
  }
  if (!child.stdout || !child.stderr) {
    child.kill('SIGTERM');
    throw new Error(`${command} did not expose stdout/stderr`);
  }
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const code = await waitForExit(child).finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(stderr.trim() || `${command} exited with ${code}`);
  return { stdout, stderr };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
