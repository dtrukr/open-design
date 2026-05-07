import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
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
  return {
    directoryName: path.basename(destinationPath),
    destinationPath,
    fileCount: entries.length,
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
  return {
    directoryName: path.posix.basename(destinationPath),
    destinationPath,
    fileCount: entries.length,
    uploadedAt: Date.now(),
  };
}

async function createLocalDestinationDir(projectPath: string): Promise<string> {
  for (let i = 1; i < 10_000; i += 1) {
    const name = i === 1 ? DESTINATION_BASE_NAME : `${DESTINATION_BASE_NAME}-${i}`;
    const destinationPath = path.join(projectPath, name);
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
base=${shellQuote(targetProject.path)}
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
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
  let stdout = '';
  let stderr = '';
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
