import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RegistryProject {
  name: string;
  machine?: string;
  path: string;
  ssh?: string;
  sessionPrefix?: string;
  aliases?: string[];
}

const DEFAULT_REGISTRY = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'tm',
  'projects.yml',
);

export async function listShareTargetProjects(
  registryPath = DEFAULT_REGISTRY,
): Promise<RegistryProject[]> {
  const raw = await readFile(registryPath, 'utf8');
  return parseProjectsRegistry(raw)
    .filter((project) => project.name && project.path)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveShareTargetProject(name: string): Promise<RegistryProject> {
  const needle = normalizeKey(name);
  if (!needle) throw new Error('targetProjectName required');
  const projects = await listShareTargetProjects();
  const project = projects.find((item) => {
    if (normalizeKey(item.name) === needle) return true;
    if (normalizeKey(item.sessionPrefix) === needle) return true;
    if (normalizeKey(path.basename(item.path)) === needle) return true;
    return (item.aliases || []).some((alias) => normalizeKey(alias) === needle);
  });
  if (!project) throw new Error(`project not found: ${name}`);
  return project;
}

export function parseProjectsRegistry(raw: string): RegistryProject[] {
  const lines = raw.split(/\r?\n/);
  const out: RegistryProject[] = [];
  let inProjects = false;
  let current: Record<string, unknown> | null = null;
  let activeListKey: string | null = null;

  function commit(): void {
    if (!current) return;
    const name = stringValue(current.name);
    const projectPath = stringValue(current.path);
    if (name && projectPath) {
      const project: RegistryProject = {
        name,
        path: projectPath,
      };
      const machine = stringValue(current.machine);
      const ssh = stringValue(current.ssh);
      const sessionPrefix = stringValue(current.session_prefix);
      const aliases = arrayValue(current.aliases);
      if (machine) project.machine = machine;
      if (ssh) project.ssh = ssh;
      if (sessionPrefix) project.sessionPrefix = sessionPrefix;
      if (aliases) project.aliases = aliases;
      out.push(project);
    }
    current = null;
    activeListKey = null;
  }

  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    if (!inProjects) {
      if (/^projects:\s*$/.test(line)) inProjects = true;
      continue;
    }

    const projectMatch = /^-\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (projectMatch) {
      commit();
      current = {};
      activeListKey = null;
      current[projectMatch[1]!] = parseScalar(projectMatch[2] || '');
      continue;
    }

    const nestedListMatch = /^\s+-\s+(.+)$/.exec(line);
    if (nestedListMatch && current && activeListKey) {
      const value = parseScalar(nestedListMatch[1] || '');
      const prior = Array.isArray(current[activeListKey]) ? current[activeListKey] as unknown[] : [];
      current[activeListKey] = [...prior, value];
      continue;
    }

    const fieldMatch = /^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!fieldMatch || !current) continue;
    const key = fieldMatch[1]!;
    const value = fieldMatch[2] || '';
    if (value === '') {
      current[key] = [];
      activeListKey = key;
    } else {
      current[key] = parseScalar(value);
      activeListKey = null;
    }
  }
  commit();
  return out;
}

function parseScalar(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2] || '' : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return items.length ? items : undefined;
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
