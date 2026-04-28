import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { DesignSystemSummary, Surface } from '../types';
import { Icon } from './Icon';

interface Props {
  systems: DesignSystemSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}

type SurfaceFilter = 'all' | Surface;

const SURFACE_PILLS: { value: SurfaceFilter; labelKey: keyof Dict; icon: 'grid' | 'image' | 'video' | 'music' | null }[] = [
  { value: 'all', labelKey: 'common.all', icon: null },
  { value: 'web', labelKey: 'ds.surfaceWeb', icon: 'grid' },
  { value: 'image', labelKey: 'ds.surfaceImage', icon: 'image' },
  { value: 'video', labelKey: 'ds.surfaceVideo', icon: 'video' },
  { value: 'audio', labelKey: 'ds.surfaceAudio', icon: 'music' },
];

function surfaceOf(system: DesignSystemSummary): Surface {
  return system.surface ?? 'web';
}

const CATEGORY_ORDER = [
  'Starter',
  'AI & LLM',
  'Developer Tools',
  'Productivity & SaaS',
  'Backend & Data',
  'Design & Creative',
  'Fintech & Crypto',
  'E-Commerce & Retail',
  'Media & Consumer',
  'Automotive',
];

export function DesignSystemsTab({ systems, selectedId, onSelect, onPreview }: Props) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');

  // Pre-scope by surface so the category dropdown only lists categories
  // that exist within the active surface — avoids ghost options that
  // would yield zero rows.
  const surfaceScoped = useMemo(
    () =>
      surfaceFilter === 'all'
        ? systems
        : systems.filter((s) => surfaceOf(s) === surfaceFilter),
    [systems, surfaceFilter],
  );

  const surfaceCounts = useMemo(() => {
    const counts: Record<SurfaceFilter, number> = {
      all: systems.length,
      web: 0,
      image: 0,
      video: 0,
      audio: 0,
    };
    for (const s of systems) counts[surfaceOf(s)]++;
    return counts;
  }, [systems]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of surfaceScoped) cats.add(s.category || 'Uncategorized');
    const ordered: string[] = [];
    for (const c of CATEGORY_ORDER) if (cats.has(c)) ordered.push(c);
    for (const c of [...cats].sort()) if (!ordered.includes(c)) ordered.push(c);
    return ['All', ...ordered];
  }, [surfaceScoped]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return surfaceScoped.filter((s) => {
      if (category !== 'All' && (s.category || 'Uncategorized') !== category) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q)
      );
    });
  }, [surfaceScoped, filter, category]);

  // The category metadata coming from each design system is authored in
  // English. We translate the well-known buckets (All / Uncategorized) but
  // pass the rest through unchanged so user-facing labels stay aligned with
  // the underlying tags.
  const renderCategory = (c: string) => {
    if (c === 'All') return t('ds.categoryAll');
    if (c === 'Uncategorized') return t('ds.categoryUncategorized');
    return c;
  };

  return (
    <div className="tab-panel">
      <div
        className="examples-filter-row"
        role="tablist"
        aria-label={t('ds.surfaceLabel')}
      >
        <span className="examples-filter-label">{t('ds.surfaceLabel')}</span>
        {SURFACE_PILLS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={surfaceFilter === p.value}
            className={`filter-pill ${surfaceFilter === p.value ? 'active' : ''}`}
            onClick={() => {
              setSurfaceFilter(p.value);
              setCategory('All');
            }}
          >
            {p.icon ? <Icon name={p.icon} size={12} /> : null}
            {t(p.labelKey)}
            <span className="filter-pill-count">{surfaceCounts[p.value]}</span>
          </button>
        ))}
      </div>
      <div className="tab-panel-toolbar">
        <input
          placeholder={t('ds.searchPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {renderCategory(c)}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="tab-empty">{t('ds.emptyNoMatch')}</div>
      ) : (
        <div className="ds-list">
          {filtered.map((s) => {
            const active = s.id === selectedId;
            return (
              <div
                key={s.id}
                className={`ds-row ${active ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="ds-row-body">
                  <div className="ds-row-title">
                    {s.title}
                    {active ? (
                      <span className="ds-row-default">
                        {t('ds.badgeDefault')}
                      </span>
                    ) : null}
                  </div>
                  <div className="ds-row-summary">{s.summary || s.category}</div>
                </div>
                {s.swatches && s.swatches.length > 0 ? (
                  <div className="ds-row-swatches" aria-hidden>
                    {s.swatches.map((c, i) => (
                      <span
                        key={i}
                        className="ds-row-swatch"
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                ) : null}
                <button
                  className="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreview(s.id);
                  }}
                  title={t('ds.previewTitle')}
                >
                  {t('ds.preview')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
