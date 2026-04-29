import type { AppConfig } from '../types';

const STORAGE_KEY = 'open-design:config';

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'daemon',
  provider: 'anthropic',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiVersion: '',
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: false,
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    // The spread-merge IS the migration path: any field added to
    // DEFAULT_CONFIG (e.g. `provider`, `apiVersion`) lands on existing
    // localStorage configs that predate it. Keep the spread — replacing
    // it with `parsed ?? DEFAULT_CONFIG` would break the round-trip.
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
