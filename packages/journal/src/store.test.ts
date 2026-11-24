import { describe, expect, it } from 'vitest';
import { leaves, type LayoutNode } from '@lambda-house/workbench';
import type { StateStorage } from 'zustand/middleware';
import { createJournalStore, detailPanes, listPanes, MAIN_DETAIL, MAIN_LIST } from './store';
import type { Session, Snapshot } from './sessions';

const session = (id: string) => ({ id, provider: 'codex', parentId: null, modified: 1 } as unknown as Session);
const snapshot = (...ids: string[]): Snapshot => ({ sessions: ids.map(session), errors: [], scannedFiles: 0, pendingFiles: 0, indexedAt: 1 });

function memory(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

const store = (storage: StateStorage | null = null) => createJournalStore({ storage, name: 'journal-test' });
const shown = (s: ReturnType<typeof store>) => detailPanes(s.getState()).map((id) => s.getState().details[id].session);

describe('the journal store', () => {
  it('opens as a list beside a detail pane, which shows the newest session once one comes', () => {
    const s = store();
    expect(leaves(s.getState().layout).map((l) => l.pane?.type)).toEqual(['journal-list', 'journal-detail']);
    s.getState().receive(snapshot('a', 'b'));
    expect(shown(s)).toEqual(['codex:a']);
    // A later snapshot leaves the choice alone
    s.getState().show('codex:b');
    s.getState().receive(snapshot('a', 'b'));
    expect(shown(s)).toEqual(['codex:b']);
  });

  it('shows a session in the detail pane focused last, or beside it', () => {
    const s = store();
    s.getState().show('codex:a');
    const side = s.getState().show('codex:b', { side: true });
    expect(shown(s)).toEqual(['codex:a', 'codex:b']);
    expect(s.getState().focused).toBe(side);
    // A click now goes to the new pane, which was focused last
    s.getState().show('codex:c');
    expect(shown(s)).toEqual(['codex:a', 'codex:c']);
    s.getState().focus(MAIN_DETAIL);
    s.getState().show('codex:d');
    expect(shown(s)).toEqual(['codex:d', 'codex:c']);
    // The list keeps its width; the details share the rest
    const root = s.getState().layout as Extract<LayoutNode, { kind: 'split' }>;
    expect(root.sizes).toEqual([{ px: 340 }, { fr: 0.5 }, { fr: 0.5 }]);
  });

  it('closes detail panes but keeps one, and the next click goes to one that is left', () => {
    const s = store();
    const side = s.getState().show('codex:b', { side: true });
    s.getState().closePane(side);
    expect(detailPanes(s.getState())).toEqual([MAIN_DETAIL]);
    expect(s.getState().lastDetail).toBe(MAIN_DETAIL);
    s.getState().closePane(MAIN_DETAIL);
    s.getState().closePane(MAIN_LIST);
    expect(detailPanes(s.getState())).toEqual([MAIN_DETAIL]);
    expect(listPanes(s.getState())).toEqual([MAIN_LIST]);
  });

  it('keeps each list its own filters', () => {
    const s = store();
    s.getState().setFilters(MAIN_LIST, { query: 'parser', directory: '/work' });
    expect(s.getState().lists[MAIN_LIST]).toMatchObject({ query: 'parser', directory: '/work', provider: 'all' });
    s.getState().clearFilters(MAIN_LIST);
    expect(s.getState().lists[MAIN_LIST].query).toBe('');
    s.getState().setFilters('nowhere', { query: 'x' });
    expect(s.getState().lists.nowhere).toBeUndefined();
  });

  it('shows cited evidence alone in its session until the session changes', () => {
    const s = store();
    const event = { seq: 7, at: '', kind: 'tool', text: 'grep', tool: 'shell' };
    s.getState().setDetail(MAIN_DETAIL, { tab: 'usage', eventFilter: 'user' });
    s.getState().inspect('codex:a', event);
    expect(s.getState().details[MAIN_DETAIL]).toMatchObject({ session: 'codex:a', tab: 'activity', eventFilter: 'all' });
    expect(s.getState().evidence[MAIN_DETAIL]).toEqual({ session: 'codex:a', event });
    s.getState().setDetail(MAIN_DETAIL, { session: 'codex:b' });
    expect(s.getState().evidence[MAIN_DETAIL]).toBeUndefined();
  });

  it('accepts a resized layout of the same panes only', () => {
    const s = store();
    const root = s.getState().layout as Extract<LayoutNode, { kind: 'split' }>;
    s.getState().setLayout({ ...root, sizes: [{ px: 400 }, { fr: 1 }] });
    expect((s.getState().layout as typeof root).sizes[0]).toEqual({ px: 400 });
    s.getState().setLayout({ kind: 'leaf', id: MAIN_LIST, pane: { type: 'journal-list', key: MAIN_LIST } });
    expect(leaves(s.getState().layout)).toHaveLength(2);
  });

  it('keeps the layout, filters and shown sessions between runs, not the snapshot', () => {
    const storage = memory();
    const first = store(storage);
    first.getState().receive(snapshot('a'));
    first.getState().setFilters(MAIN_LIST, { provider: 'claude' });
    const side = first.getState().show('codex:b', { side: true });
    first.getState().setDetail(side, { tab: 'usage' });

    const second = store(storage);
    expect(detailPanes(second.getState())).toEqual([MAIN_DETAIL, side]);
    expect(shown(second)).toEqual(['codex:a', 'codex:b']);
    expect(second.getState().details[side].tab).toBe('usage');
    expect(second.getState().lists[MAIN_LIST].provider).toBe('claude');
    expect(second.getState().lastDetail).toBe(side);
    expect(second.getState().snapshot.sessions).toEqual([]);
  });

  it('zooms each pane on its own: a copy beside it takes its zoom, a closed one takes its zoom along, and it is kept', () => {
    const storage = memory();
    const s = store(storage);
    s.getState().zoomPane(MAIN_DETAIL, 1);
    s.getState().zoomPane(MAIN_DETAIL, 1);
    expect(s.getState().zoom).toEqual({ [MAIN_DETAIL]: 121 });
    expect(s.getState().zoom[MAIN_LIST]).toBeUndefined();
    const copy = s.getState().splitPane(MAIN_DETAIL, 'row')!;
    expect(s.getState().zoom[copy]).toBe(121);
    s.getState().closePane(copy);
    expect(Object.keys(s.getState().zoom)).toEqual([MAIN_DETAIL]);
    // Kept between runs; a zoom for no pane, or out of range, is dropped
    expect(store(storage).getState().zoom).toEqual({ [MAIN_DETAIL]: 121 });
    const saved = JSON.parse(storage.getItem('journal-test') as string);
    saved.state.zoom = { [MAIN_DETAIL]: 9000, [MAIN_LIST]: 90, gone: 150 };
    storage.setItem('journal-test', JSON.stringify(saved));
    expect(store(storage).getState().zoom).toEqual({ [MAIN_LIST]: 90 });
    // Back to 100 % leaves nothing behind
    s.getState().zoomPane(MAIN_DETAIL, 0);
    expect(s.getState().zoom).toEqual({});
  });

  it('starts again from a saved layout that does not fit its panes', () => {
    const storage = memory();
    storage.setItem('journal-test', JSON.stringify({ state: { layout: { kind: 'leaf', id: 'x', pane: { type: 'journal-detail', key: 'x' } }, lists: {}, details: { x: {} } }, version: 1 }));
    const s = store(storage);
    expect(leaves(s.getState().layout).map((l) => l.id)).toEqual([MAIN_LIST, MAIN_DETAIL]);
  });
});
