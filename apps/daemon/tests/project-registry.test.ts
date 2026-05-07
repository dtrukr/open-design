import { describe, expect, it } from 'vitest';
import { parseProjectsRegistry } from '../src/project-registry.js';

describe('project registry parser', () => {
  it('extracts share target fields from tm projects.yml', () => {
    const projects = parseProjectsRegistry(`
version: 1
projects:
- name: alpha
  machine: host-a
  ssh: dennis@example.test
  path: /Users/dennis/git/alpha
  session_prefix: alpha
  aliases:
  - a
  dev_services:
  - service_name: alpha-app
    framework: nextjs
    app_dir: /Users/dennis/git/alpha
    port: 3000
- name: beta
  path: /Users/dennis/git/beta
`);

    expect(projects).toEqual([
      {
        name: 'alpha',
        machine: 'host-a',
        path: '/Users/dennis/git/alpha',
        ssh: 'dennis@example.test',
        sessionPrefix: 'alpha',
        aliases: ['a'],
      },
      {
        name: 'beta',
        path: '/Users/dennis/git/beta',
      },
    ]);
  });
});
