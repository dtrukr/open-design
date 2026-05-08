import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';

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
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new Error(`invalid projects.yml: ${doc.errors[0]?.message ?? 'YAML parse failed'}`);
  }
  const data = doc.toJS() as unknown;
  if (!isRecord(data) || !Array.isArray(data.projects)) return [];
  return data.projects
    .filter(isRecord)
    .map(projectFromYaml)
    .filter((project): project is RegistryProject => Boolean(project));
}

function projectFromYaml(raw: Record<string, unknown>): RegistryProject | null {
  const name = stringValue(raw.name);
  const projectPath = stringValue(raw.path);
  if (!name || !projectPath) return null;
  const project: RegistryProject = {
    name,
    path: projectPath,
  };
  const machine = stringValue(raw.machine);
  const ssh = stringValue(raw.ssh);
  const sessionPrefix = stringValue(raw.session_prefix);
  const aliases = arrayValue(raw.aliases);
  if (machine) project.machine = machine;
  if (ssh) project.ssh = ssh;
  if (sessionPrefix) project.sessionPrefix = sessionPrefix;
  if (aliases) project.aliases = aliases;
  return project;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
