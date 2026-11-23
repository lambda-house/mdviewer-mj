// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { agentEntryMatches } from './agent';
import type { AgentEntry } from './tauri';

describe('agent list helpers', () => {
  const entry: AgentEntry = {
    path: '/repo/.cursor/rules/api.mdc',
    kind: 'rule',
    title: 'api',
    description: 'Applies to src/api/**',
    group: '~/repo',
    scope: 'project',
    modified: 0,
    unread: false,
    isNew: false,
  };

  it('filters on title, description, group and path', () => {
    expect(agentEntryMatches(entry, '')).toBe(true);
    expect(agentEntryMatches(entry, 'API')).toBe(true);
    expect(agentEntryMatches(entry, 'src/api')).toBe(true);
    expect(agentEntryMatches(entry, '.cursor')).toBe(true);
    expect(agentEntryMatches(entry, 'memory')).toBe(false);
  });
});
