import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from './srcdoc';

describe('buildSrcdoc deck bridge', () => {
  it('only uses directly mutable slide conventions for setActive support', () => {
    const srcdoc = buildSrcdoc(
      '<section class="slide">One</section><section class="slide">Two</section>',
      { deck: true }
    );

    const canSetActive = srcdoc.match(/function canSetActive\(list\)\{([\s\S]*?)\n  \}/)?.[1] ?? '';

    expect(canSetActive).toContain('findActiveByClass(list) >= 0');
    expect(canSetActive).toContain("list[i].style.display === 'none'");
    expect(canSetActive).toContain("list[i].style.visibility === 'hidden'");
    expect(canSetActive).toContain("list[i].hasAttribute('hidden')");
    expect(canSetActive).not.toContain('findActiveByVisibility');
  });
});
