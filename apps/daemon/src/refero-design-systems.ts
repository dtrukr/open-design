// @ts-nocheck
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REFERO_STYLES_BASE_URL = 'https://styles.refero.design';

export interface ReferoDesignSystemSyncOptions {
  rootDir: string;
  baseUrl?: string;
  sort?: 'popular' | 'trending' | 'newest' | null;
  force?: boolean;
  maxPages?: number | null;
  maxStyles?: number | null;
  concurrency?: number;
  timeoutMs?: number;
}

export interface ReferoDesignSystemSyncResult {
  wrote: number;
  failed: number;
  total: number;
  pages: number;
  rootDir: string;
  startedAt: string;
  finishedAt: string;
  errors: string[];
}

export interface ReferoDesignSystemSyncStatus {
  enabled: boolean;
  running: boolean;
  rootDir: string;
  lastRun: ReferoDesignSystemSyncResult | null;
  lastError: string | null;
}

interface ReferoStyleListItem {
  id: string;
  url?: string;
  siteName?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
  iconUrl?: string | null;
  previewVideoUrl?: string;
  previewVideoPosterUrl?: string;
  previewVideoWidth?: number;
  previewVideoHeight?: number;
  previewVideoDetailUrl?: string;
  previewVideoDetailPosterUrl?: string;
  previewVideoDetailWidth?: number;
  previewVideoDetailHeight?: number;
  previewVideoDurationMs?: number;
  colorScheme?: string;
  colors?: unknown[];
  fonts?: string[];
  northStar?: string;
  createdAt?: string;
}

interface ReferoStyleListResponse {
  styles?: ReferoStyleListItem[];
  nextPage?: number | null;
}

interface ReferoStyleDetailResponse {
  style?: ReferoStyleDetail;
  similar?: ReferoStyleListItem[];
}

type ReferoStyleDetail = ReferoStyleListItem & {
  industry?: string;
  previewVideoCapturedAt?: string;
  fullResult?: {
    designSystem?: {
      dos?: unknown[];
      donts?: unknown[];
      tags?: unknown[];
      theme?: string;
      colors?: unknown[];
      layout?: unknown;
      imagery?: unknown;
      spacing?: unknown;
      category?: string;
      surfaces?: unknown;
      northStar?: string;
      typeScale?: unknown[];
      components?: unknown[];
      typography?: unknown;
      description?: string;
      elevationPhilosophy?: string;
    };
    screenshot?: {
      url?: string;
      thumbnail?: string;
    };
  };
};

interface ReferoFetchedStyle {
  listItem: ReferoStyleListItem;
  detail: ReferoStyleDetail | null;
}

interface ReferoCacheManifest {
  source: string;
  sort: string | null;
  syncedAt: string;
  total: number;
  wrote: number;
  failed: number;
  pages: number;
  errors: string[];
}

export async function syncReferoDesignSystems(
  options: ReferoDesignSystemSyncOptions,
): Promise<ReferoDesignSystemSyncResult> {
  const rootDir = path.resolve(options.rootDir);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? REFERO_STYLES_BASE_URL);
  const force = Boolean(options.force);
  const maxPages = positiveOrNull(options.maxPages);
  const maxStyles = positiveOrNull(options.maxStyles);
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000);
  const startedAt = new Date().toISOString();

  if (!force && (await cacheLooksFresh(rootDir))) {
    const manifest = await readManifest(rootDir);
    return {
      wrote: manifest?.wrote ?? manifest?.total ?? 0,
      failed: manifest?.failed ?? 0,
      total: manifest?.total ?? 0,
      pages: manifest?.pages ?? 0,
      rootDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      errors: [],
    };
  }

  const { styles, pages } = await fetchStyleList({
    baseUrl,
    sort: options.sort ?? null,
    maxPages,
    maxStyles,
    timeoutMs,
  });
  const errors: string[] = [];
  const fetched = await runPool(styles, concurrency, async (listItem) => {
    try {
      const detail = await fetchStyleDetail(baseUrl, listItem.id, timeoutMs);
      return { listItem, detail };
    } catch (err) {
      if (errors.length < 20) {
        errors.push(`${listItem.id}: ${(err as Error).message ?? String(err)}`);
      }
      return { listItem, detail: null };
    }
  });

  const tmpDir = path.join(
    path.dirname(rootDir),
    `.${path.basename(rootDir)}.${process.pid}.${Date.now()}.tmp`,
  );
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  let wrote = 0;
  let failed = 0;
  const seenIds = new Set<string>();
  for (const item of fetched) {
    try {
      const style = item.detail ?? item.listItem;
      const id = uniqueId(referoDesignSystemId(style), seenIds);
      await mkdir(path.join(tmpDir, id), { recursive: true });
      await writeFile(
        path.join(tmpDir, id, 'DESIGN.md'),
        renderDesignSystemMarkdown(id, item),
        'utf8',
      );
      wrote++;
    } catch (err) {
      failed++;
      if (errors.length < 20) {
        errors.push(`${item.listItem.id}: ${(err as Error).message ?? String(err)}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const manifest: ReferoCacheManifest = {
    source: baseUrl,
    sort: options.sort ?? null,
    syncedAt: finishedAt,
    total: styles.length,
    wrote,
    failed,
    pages,
    errors,
  };
  await writeFile(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  await rm(rootDir, { recursive: true, force: true });
  await rename(tmpDir, rootDir);

  return {
    wrote,
    failed,
    total: styles.length,
    pages,
    rootDir,
    startedAt,
    finishedAt,
    errors,
  };
}

export function createReferoDesignSystemSyncer(options: {
  rootDir: string;
  enabled?: boolean;
  intervalMs?: number;
  staleMs?: number;
  maxPages?: number | null;
  maxStyles?: number | null;
  concurrency?: number;
  timeoutMs?: number;
  baseUrl?: string;
  sort?: 'popular' | 'trending' | 'newest' | null;
  log?: (message: string) => void;
}) {
  const enabled = options.enabled ?? true;
  const intervalMs = Math.max(60_000, options.intervalMs ?? 24 * 60 * 60 * 1_000);
  const staleMs = Math.max(60_000, options.staleMs ?? intervalMs);
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<ReferoDesignSystemSyncResult> | null = null;
  let lastRun: ReferoDesignSystemSyncResult | null = null;
  let lastError: string | null = null;

  async function run(force = false): Promise<ReferoDesignSystemSyncResult> {
    if (!enabled) {
      throw new Error('Refero design-system sync is disabled');
    }
    if (running) return running;
    running = syncReferoDesignSystems({
      rootDir: options.rootDir,
      baseUrl: options.baseUrl,
      sort: options.sort,
      maxPages: options.maxPages,
      maxStyles: options.maxStyles,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      force,
    })
      .then((result) => {
        lastRun = result;
        lastError = null;
        options.log?.(
          `[refero] synced ${result.wrote}/${result.total} design systems into ${result.rootDir}`,
        );
        return result;
      })
      .catch((err) => {
        lastError = (err as Error).message ?? String(err);
        options.log?.(`[refero] sync failed: ${lastError}`);
        throw err;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  function start(): void {
    if (!enabled || timer) return;
    void shouldSync(options.rootDir, staleMs)
      .then((stale) => {
        if (stale) void run(true).catch(() => {});
      })
      .catch(() => {
        void run(true).catch(() => {});
      });
    timer = setInterval(() => {
      void run(true).catch(() => {});
    }, intervalMs);
    timer.unref?.();
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function status(): ReferoDesignSystemSyncStatus {
    return {
      enabled,
      running: Boolean(running),
      rootDir: options.rootDir,
      lastRun,
      lastError,
    };
  }

  return { start, stop, run, status };
}

async function fetchStyleList(options: {
  baseUrl: string;
  sort: 'popular' | 'trending' | 'newest' | null;
  maxPages: number | null;
  maxStyles: number | null;
  timeoutMs: number;
}): Promise<{ styles: ReferoStyleListItem[]; pages: number }> {
  const styles: ReferoStyleListItem[] = [];
  let page = 1;
  let pages = 0;
  for (;;) {
    if (options.maxPages && page > options.maxPages) break;
    const url = new URL('/api/styles', options.baseUrl);
    url.searchParams.set('page', String(page));
    if (options.sort) url.searchParams.set('sort', options.sort);
    const data = await fetchJson<ReferoStyleListResponse>(url.toString(), options.timeoutMs);
    pages++;
    const batch = Array.isArray(data.styles) ? data.styles : [];
    for (const style of batch) {
      if (!style.id) continue;
      styles.push(style);
      if (options.maxStyles && styles.length >= options.maxStyles) {
        return { styles, pages };
      }
    }
    if (!data.nextPage || batch.length === 0) break;
    page = data.nextPage;
  }
  return { styles, pages };
}

async function fetchStyleDetail(
  baseUrl: string,
  id: string,
  timeoutMs: number,
): Promise<ReferoStyleDetail> {
  const url = new URL(`/api/styles/${encodeURIComponent(id)}`, baseUrl);
  const data = await fetchJson<ReferoStyleDetailResponse>(url.toString(), timeoutMs);
  if (!data.style) throw new Error('missing style payload');
  return data.style;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`${url} failed: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function shouldSync(rootDir: string, staleMs: number): Promise<boolean> {
  const manifest = await readManifest(rootDir);
  if (!manifest?.syncedAt) return true;
  const syncedAt = Date.parse(manifest.syncedAt);
  if (!Number.isFinite(syncedAt)) return true;
  return Date.now() - syncedAt > staleMs;
}

async function cacheLooksFresh(rootDir: string): Promise<boolean> {
  const manifest = await readManifest(rootDir);
  return Boolean(manifest?.syncedAt && manifest.wrote > 0);
}

async function readManifest(rootDir: string): Promise<ReferoCacheManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(rootDir, 'manifest.json'), 'utf8')) as ReferoCacheManifest;
  } catch {
    return null;
  }
}

function renderDesignSystemMarkdown(
  id: string,
  item: ReferoFetchedStyle,
): string {
  const style = item.detail ?? item.listItem;
  const designSystem = item.detail?.fullResult?.designSystem;
  const siteName = cleanInline(style.siteName || item.listItem.siteName || 'Refero Style', 90);
  const title = cleanHeading(siteName);
  const category = cleanInline(
    designSystem?.category || item.detail?.industry || 'Refero Styles',
    80,
  );
  const description = cleanParagraph(
    designSystem?.description
      || designSystem?.northStar
      || style.northStar
      || `A Refero-derived design system for ${siteName}.`,
    520,
  );
  const theme = cleanParagraph(designSystem?.theme || style.northStar || '', 360);
  const colors = extractDesignColors(designSystem?.colors, style.colors);
  const fonts = extractFonts(style.fonts, designSystem?.typography, designSystem?.typeScale);
  const components = extractComponents(designSystem?.components);
  const dos = extractTextList(designSystem?.dos, 8, 180);
  const donts = extractTextList(designSystem?.donts, 8, 180);
  const tags = extractTextList(designSystem?.tags, 10, 40);
  const spacing = cleanParagraph(designSystem?.spacing, 380);
  const layout = cleanParagraph(designSystem?.layout, 420);
  const imagery = cleanParagraph(designSystem?.imagery, 420);
  const surfaces = cleanParagraph(designSystem?.surfaces, 420);
  const elevation = cleanParagraph(designSystem?.elevationPhilosophy, 260);
  const screenshotUrl =
    style.screenshotUrl || item.detail?.fullResult?.screenshot?.url || style.thumbnailUrl || '';
  const thumbnailUrl =
    style.thumbnailUrl || item.detail?.fullResult?.screenshot?.thumbnail || '';

  const lines: string[] = [];
  lines.push(`# Design System Inspired by ${title}`);
  lines.push('');
  lines.push(`> Category: ${category}`);
  lines.push('> Surface: web');
  lines.push('');
  lines.push(description);
  if (theme && theme !== description) {
    lines.push('');
    lines.push(`North star: ${theme}`);
  }
  if (tags.length > 0) {
    lines.push('');
    lines.push(`Tags: ${tags.join(', ')}.`);
  }
  lines.push('');
  lines.push('## 1. Visual Theme & Atmosphere');
  lines.push('');
  lines.push(
    theme
      || description
      || `${siteName} uses a Refero-harvested web design language with extracted color, typography, layout, component, and motion cues.`,
  );
  if (style.colorScheme) {
    lines.push('');
    lines.push(`Primary color scheme: ${cleanInline(style.colorScheme, 40)}.`);
  }
  lines.push('');
  lines.push('## 2. Color Palette & Roles');
  lines.push('');
  if (colors.length > 0) {
    for (const color of colors) {
      lines.push(`- **${color.name}** (\`${color.hex}\`): ${color.role}`);
    }
  } else {
    lines.push('- **Background:** `#ffffff` - Primary page background.');
    lines.push('- **Ink:** `#111111` - Primary text and contrast color.');
    lines.push('- **Accent:** `#2f6feb` - Primary action and highlight color.');
  }
  lines.push('');
  lines.push('## 3. Typography Rules');
  lines.push('');
  lines.push(`- **Display:** \`${fonts.display}\` - Headlines, hero statements, and major section labels.`);
  lines.push(`- **Body:** \`${fonts.body}\` - Product copy, descriptions, controls, and readable content.`);
  lines.push(`- **Mono:** \`${fonts.mono}\` - Technical labels, metadata, code, and compact utility text.`);
  if (cleanParagraph(designSystem?.typography, 420)) {
    lines.push('');
    lines.push(cleanParagraph(designSystem?.typography, 420));
  }
  lines.push('');
  lines.push('## 4. Spacing & Grid');
  lines.push('');
  lines.push(spacing || 'Use a measured editorial rhythm: compact utility spacing for controls, wider section spacing for story beats, and consistent alignment across cards, navigation, and content bands.');
  lines.push('');
  lines.push('## 5. Layout, Imagery & Surfaces');
  lines.push('');
  lines.push(layout || 'Favor a product-led web composition with clear hierarchy, scannable sections, and enough negative space for the palette and typography to carry the brand character.');
  if (imagery) lines.push(`\nImagery: ${imagery}`);
  if (surfaces) lines.push(`\nSurfaces: ${surfaces}`);
  if (elevation) lines.push(`\nElevation: ${elevation}`);
  lines.push('');
  lines.push('## 6. Components');
  lines.push('');
  if (components.length > 0) {
    for (const component of components) {
      lines.push(`- **${component.name}:** ${component.description}`);
    }
  } else {
    lines.push('- **Navigation:** Keep page-level navigation direct, high-contrast, and aligned to the dominant brand grid.');
    lines.push('- **Primary CTA:** Use the primary accent color with clear hover and focus states.');
    lines.push('- **Cards:** Use extracted surface, border, and typography tokens to keep repeated content consistent.');
  }
  if (dos.length > 0 || donts.length > 0) {
    lines.push('');
    lines.push('## 7. Usage Rules');
    lines.push('');
    for (const itemText of dos) lines.push(`- Do: ${itemText}`);
    for (const itemText of donts) lines.push(`- Do not: ${itemText}`);
  }
  lines.push('');
  lines.push('## 8. Motion & Interaction');
  lines.push('');
  lines.push('Use subtle live-view motion: responsive hover feedback, focused transitions between surfaces, and restrained scroll rhythm. Let the existing Open Design preview and showcase routes render this system dynamically from these tokens.');
  lines.push('');
  lines.push('## 9. Source & Metadata');
  lines.push('');
  lines.push(`- Refero design system ID: \`${id}\``);
  lines.push(`- Refero style ID: \`${cleanInline(style.id || item.listItem.id, 80)}\``);
  if (style.url) lines.push(`- Source URL: ${cleanUrl(style.url)}`);
  if (screenshotUrl) lines.push(`- Screenshot: ${cleanUrl(screenshotUrl)}`);
  if (thumbnailUrl) lines.push(`- Thumbnail: ${cleanUrl(thumbnailUrl)}`);
  if (style.previewVideoUrl) lines.push(`- Preview video: ${cleanUrl(style.previewVideoUrl)}`);
  if (style.createdAt) lines.push(`- Refero created at: ${cleanInline(style.createdAt, 80)}`);
  lines.push('');
  return lines.join('\n');
}

function extractDesignColors(
  designColors: unknown[] | undefined,
  listColors: unknown[] | undefined,
): Array<{ name: string; hex: string; role: string }> {
  const out: Array<{ name: string; hex: string; role: string }> = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    const record = asRecord(raw);
    if (!record) return;
    const hex = normalizeHex(
      firstString(record, ['hex', 'value', 'color', 'background', 'foreground']),
    );
    if (!hex) return;
    const name =
      cleanColorName(firstString(record, ['name', 'label', 'token', 'variable', 'cssVar']))
      || `Color ${out.length + 1}`;
    const role =
      cleanParagraph(
        firstString(record, ['role', 'usage', 'description', 'notes', 'intent', 'rationale']),
        180,
      )
      || inferColorRole(name);
    const key = `${name.toLowerCase()}|${hex}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, hex, role });
  };
  for (const color of designColors ?? []) push(color);
  for (const color of listColors ?? []) push(color);
  return out.slice(0, 18);
}

function extractFonts(
  listFonts: unknown[] | undefined,
  typography: unknown,
  typeScale: unknown[] | undefined,
): { display: string; body: string; mono: string } {
  const candidates = [
    ...fontCandidates(listFonts),
    ...fontCandidates(Array.isArray(typography) ? typography : []),
    ...fontCandidates(typeScale),
  ];
  const families = candidates.map((candidate) => candidate.family).filter(Boolean);
  const typographyText = typeof typography === 'string' ? cleanParagraph(typography, 800) : '';
  const display =
    findCandidateFontByHint(candidates, ['display', 'heading', 'headline', 'title', 'hero'])
    || families[0]
    || fontFromText(typographyText)
    || "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const body =
    findCandidateFontByHint(candidates, ['body', 'text', 'paragraph', 'copy'])
    || families.find((font) => font !== display)
    || display;
  const mono =
    findCandidateFontByHint(candidates, ['mono', 'code'])
    || "ui-monospace, SFMono-Regular, Menlo, monospace";
  return { display, body, mono };
}

function fontCandidates(input: unknown[] | undefined): Array<{ label: string; family: string }> {
  const out: Array<{ label: string; family: string }> = [];
  for (const item of input ?? []) {
    if (typeof item === 'string') {
      const family = cleanInline(item, 80);
      if (family) out.push({ label: family, family });
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const family = cleanInline(
      firstString(record, ['family', 'fontFamily', 'font', 'fontFace', 'typeface']),
      80,
    );
    if (!family) continue;
    const label = cleanInline(firstString(record, ['role', 'name', 'label', 'usage']), 80);
    out.push({ label, family });
  }
  return out;
}

function extractComponents(input: unknown[] | undefined): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  for (const item of input ?? []) {
    const record = asRecord(item);
    if (record) {
      const name = cleanInline(
        firstString(record, ['name', 'component', 'type', 'title', 'label']) || `Component ${out.length + 1}`,
        60,
      );
      const description = componentDescription(record, name);
      if (name && description) out.push({ name, description });
    } else {
      const description = cleanParagraph(item, 260);
      if (description) out.push({ name: `Component ${out.length + 1}`, description });
    }
    if (out.length >= 14) break;
  }
  return out;
}

function componentDescription(record: Record<string, unknown>, name: string): string {
  const direct = cleanParagraph(
    firstString(record, ['description', 'usage', 'notes', 'behavior', 'style', 'purpose']),
    260,
  );
  if (direct && !looksLikeCode(direct)) return direct;
  const details: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (/^(html|css|code|markup|example|preview)$/i.test(key)) continue;
    if (/^(name|component|type|title|label)$/i.test(key)) continue;
    const text = cleanParagraph(value, 120);
    if (!text || looksLikeCode(text)) continue;
    details.push(`${cleanInline(key, 32)}: ${text}`);
    if (details.length >= 3) break;
  }
  if (details.length > 0) return details.join('; ');
  return `Use the extracted Refero component treatment for ${name.toLowerCase()}.`;
}

function looksLikeCode(value: string): boolean {
  return /(<[a-z][\s\S]*>|@import|:\s*#[0-9a-f]{3,8}|style=|class=)/i.test(value);
}

function extractTextList(input: unknown[] | undefined, limit: number, maxLength: number): string[] {
  return (input ?? [])
    .map((item) => cleanParagraph(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function referoDesignSystemId(style: ReferoStyleListItem): string {
  const slug = slugify(style.siteName || style.url || 'style');
  const shortId = slugify(style.id || '').slice(0, 8) || 'refero';
  return `refero-${slug || 'style'}-${shortId}`.slice(0, 100);
}

function uniqueId(id: string, seen: Set<string>): string {
  let candidate = id;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${id}-${index}`;
    index++;
  }
  seen.add(candidate);
  return candidate;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function stringifyBrief(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cleanHeading(value: unknown): string {
  const clean = cleanInline(value, 90);
  return clean || 'Refero Style';
}

function cleanInline(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function cleanParagraph(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : stringifyBrief(value);
  return text
    .replace(/[\r\t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function cleanColorName(value: string): string {
  return cleanInline(value, 48).replace(/:+$/g, '').trim();
}

function cleanUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return cleanInline(value, 240);
  }
}

function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('');
  if (hex.length === 4) hex = hex.split('').map((char) => char + char).join('').slice(0, 8);
  if (hex.length !== 6 && hex.length !== 8) return null;
  if (hex.length > 6) hex = hex.slice(0, 6);
  return `#${hex.toLowerCase()}`;
}

function inferColorRole(name: string): string {
  const n = name.toLowerCase();
  if (/background|canvas|paper/.test(n)) return 'Primary page background.';
  if (/surface|card|panel/.test(n)) return 'Surface, panel, or card fill.';
  if (/text|ink|foreground|heading/.test(n)) return 'Primary readable text color.';
  if (/border|divider|stroke|rule/.test(n)) return 'Borders, dividers, and quiet structure.';
  if (/accent|brand|primary|cta|action/.test(n)) return 'Primary accent and action color.';
  return 'Extracted Refero palette token.';
}

function findCandidateFontByHint(
  candidates: Array<{ label: string; family: string }>,
  hints: string[],
): string | null {
  for (const hint of hints) {
    const found = candidates.find((candidate) =>
      `${candidate.label} ${candidate.family}`.toLowerCase().includes(hint),
    );
    if (found) return found.family;
  }
  return null;
}

function fontFromText(value: string): string | null {
  const match = /["'`]([^"'`]{2,80})["'`]/.exec(value);
  return match?.[1] ?? null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value && Number.isFinite(value) ? Math.max(1, value) : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '') || REFERO_STYLES_BASE_URL;
}
