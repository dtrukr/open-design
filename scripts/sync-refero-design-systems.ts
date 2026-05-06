#!/usr/bin/env node
// Snapshot Refero Styles into Open Design DESIGN.md folders. The daemon
// also runs this sync in the background; this script is for cron, manual
// refreshes, and smoke verification.

import path from 'node:path';
import os from 'node:os';

import { syncReferoDesignSystems } from '../apps/daemon/src/refero-design-systems.ts';

interface Args {
  root: string;
  force: boolean;
  maxPages: number | null;
  maxStyles: number | null;
  concurrency: number;
  sort: 'popular' | 'trending' | 'newest' | null;
}

const repoRoot = path.resolve(import.meta.dirname, '..');

function parseArgs(argv: string[]): Args {
  const dataDir = resolveDataDir(process.env.OD_DATA_DIR, repoRoot);
  const args: Args = {
    root: path.resolve(process.env.OD_REFERO_DESIGN_SYSTEMS_DIR || path.join(dataDir, 'refero-design-systems')),
    force: true,
    maxPages: null,
    maxStyles: null,
    concurrency: 8,
    sort: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--') continue;
    const next = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`flag ${flag} expects a value`);
      return value;
    };
    switch (flag) {
      case '--root':
        args.root = path.resolve(expandHome(next()));
        break;
      case '--force':
        args.force = true;
        break;
      case '--pages':
        args.maxPages = parsePositive(next(), flag);
        break;
      case '--limit':
        args.maxStyles = parsePositive(next(), flag);
        break;
      case '--concurrency':
        args.concurrency = parsePositive(next(), flag);
        break;
      case '--sort': {
        const value = next();
        if (value !== 'popular' && value !== 'trending' && value !== 'newest') {
          throw new Error(`unknown --sort value: ${value}`);
        }
        args.sort = value;
        break;
      }
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Sync Refero Styles into Open Design design systems

Usage:
  pnpm sync:refero-design-systems [flags]

Flags:
  --root <dir>         Destination root (default: OD_DATA_DIR/refero-design-systems or .od/refero-design-systems)
  --force              Re-fetch even when a manifest already exists (default)
  --pages <n>          Cap list pagination (for smoke tests)
  --limit <n>          Cap total styles imported (for smoke tests)
  --concurrency <n>    Parallel detail fetches (default: 8)
  --sort <name>        popular | trending | newest
  -h, --help           Show this message`);
}

function parsePositive(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${flag} expects a positive integer`);
  }
  return parsed;
}

function resolveDataDir(raw: string | undefined, projectRoot: string): string {
  if (!raw) return path.join(projectRoot, '.od');
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}

function expandHome(value: string): string {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const result = await syncReferoDesignSystems({
    rootDir: args.root,
    force: args.force,
    maxPages: args.maxPages,
    maxStyles: args.maxStyles,
    concurrency: args.concurrency,
    sort: args.sort,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
