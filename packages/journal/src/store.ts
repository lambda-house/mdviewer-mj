import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { PANE_ZOOM, closeLeaf, findLeaf, leaves, splitLeaf, stepPaneZoom, type LayoutNode, type Leaf } from '@lambda-house/workbench';
import { EMPTY_SNAPSHOT, NO_FILTERS, sessionKey, type SessionEvent, type SessionFilters, type Snapshot } from './sessions';

// The journal's state (shared UI spec §6.2): the index snapshot every pane
// shares, and the layout of its panes. A `journal-list` pane has its own
// search and filters, a `journal-detail` pane its own session and tab. A
// leaf's id is its pane's key, and the key names its entry in `lists` or
// `details`. The snapshot is not saved: it is asked for again while shown.

// ============================================================
// Types
// ============================================================

export const LIST_PANE = 'journal-list';
export const DETAIL_PANE = 'journal-detail';
/** The first list and detail panes. */
export const MAIN_LIST = 'list';
export const MAIN_DETAIL = 'detail';
/** The list's width in a new layout (px). */
export const LIST_WIDTH = 340;

export const DETAIL_TABS = ['activity', 'agents', 'usage', 'memories', 'linked work', 'direct'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export interface DetailState {
  /** The session shown (`sessionKey`), '' for none. */
  session: string;
  tab: DetailTab;
  /** 'all' or an event kind. */
  eventFilter: string;
}

/** An event an agent cited as evidence, shown alone in a detail pane. Not saved. */
export interface FocusedEvidence { session: string; event: SessionEvent }

export interface JournalState {
  /** Whether session access is on; null until the backend has answered. */
  enabled: boolean | null;
  snapshot: Snapshot;
  /** What the backend called the snapshot held (`snapshotSince`): it sends one again only when that changed. */
  stamp: string;
  /** A snapshot is being asked for. */
  busy: boolean;
  error: string;

  layout: LayoutNode;
  lists: Record<string, SessionFilters>;
  details: Record<string, DetailState>;
  /** The focused pane (leaf id = pane key). */
  focused: string;
  /** The list and the detail pane focused most recently: a click in a list shows its session there; the summary counts that list. */
  lastList: string;
  lastDetail: string;
  evidence: Record<string, FocusedEvidence>;
  /** Each pane's own zoom, percent (Ctrl + wheel over it); a pane not in it is at 100. */
  zoom: Record<string, number>;

  setEnabled: (enabled: boolean | null) => void;
  setError: (error: string) => void;
  setBusy: (busy: boolean) => void;
  /** A new snapshot, with its stamp if the backend gave one; a detail pane that shows nothing yet shows the newest session. */
  receive: (snapshot: Snapshot, stamp?: string) => void;
  /** Access was revoked: nothing indexed is kept. */
  forget: () => void;

  setFilters: (list: string, filters: Partial<SessionFilters>) => void;
  clearFilters: (list: string) => void;

  /**
   * Show a session: in the detail pane focused most recently (opening one if
   * there is none), or with `side` in a new detail pane beside it. Returns the pane.
   */
  show: (key: string, options?: { side?: boolean; tab?: DetailTab }) => string;
  /** Show an event an agent cited, alone, in the activity of its session. */
  inspect: (key: string, event: SessionEvent) => void;
  clearEvidence: (detail: string) => void;
  setDetail: (detail: string, state: Partial<DetailState>) => void;
  /** A copy of a pane beside it: a list with the same filters, a detail pane on the same session. Returns the new pane. */
  splitPane: (pane: string, dir: 'row' | 'col') => string | null;
  /** Close a pane; the last list and the last detail pane stay. */
  closePane: (pane: string) => void;
  focus: (pane: string) => void;
  /** The panes' arrangement after a resize; ignored unless it holds exactly the panes. */
  setLayout: (layout: LayoutNode) => void;
  /** One list beside one detail pane again, keeping the filters and the session used last. */
  resetLayout: () => void;
  /** A pane's zoom one step in (1), out (-1) or back to 100 % (0). */
  zoomPane: (pane: string, direction: 1 | -1 | 0) => void;
}

export interface JournalStoreOptions {
  /** Where the layout and the panes' filters are kept between runs; null keeps nothing (a memory window). */
  storage: StateStorage | null;
  /** The storage key. */
  name: string;
}

export type JournalStore = UseBoundStore<StoreApi<JournalState>>;

// ============================================================
// Helpers
// ============================================================

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++counter).toString(36)}`;

export const listLeaf = (key: string): Leaf => ({ kind: 'leaf', id: key, pane: { type: LIST_PANE, key } });
export const detailLeaf = (key: string): Leaf => ({ kind: 'leaf', id: key, pane: { type: DETAIL_PANE, key } });

export const newDetail = (session = ''): DetailState => ({ session, tab: 'activity', eventFilter: 'all' });

/** A list beside a detail pane: the journal as it opens the first time. */
export function defaultLayout(): LayoutNode {
  return { kind: 'split', id: 'journal', dir: 'row', children: [listLeaf(MAIN_LIST), detailLeaf(MAIN_DETAIL)], sizes: [{ px: LIST_WIDTH }, { fr: 1 }] };
}

const panesOf = (layout: LayoutNode, type: string) =>
  leaves(layout).filter((leaf) => leaf.pane?.type === type).map((leaf) => leaf.id);

/** The detail panes in layout order. */
export const detailPanes = (state: Pick<JournalState, 'layout'>) => panesOf(state.layout, DETAIL_PANE);
export const listPanes = (state: Pick<JournalState, 'layout'>) => panesOf(state.layout, LIST_PANE);

/** The saved zooms of the panes there are, within the pane zoom's range. */
function readZoom(raw: unknown, panes: string[]): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const saved = raw as Record<string, unknown>;
  return Object.fromEntries(panes.flatMap((pane) => {
    const value = saved[pane];
    return typeof value === 'number' && value >= PANE_ZOOM.min && value <= PANE_ZOOM.max && value !== 100 ? [[pane, Math.round(value)]] : [];
  }));
}

/** Whether a layout shows the panes, each leaf once with its own key, at least one list. */
function layoutFits(layout: unknown, lists: string[], details: string[]): layout is LayoutNode {
  try {
    const shown = leaves(layout as LayoutNode);
    const ids = shown.map((leaf) => leaf.id);
    if (new Set(ids).size !== ids.length || shown.some((leaf) => leaf.pane?.key !== leaf.id)) return false;
    const of = (type: string) => shown.filter((leaf) => leaf.pane?.type === type).map((leaf) => leaf.id).sort();
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    return of(LIST_PANE).length > 0 && same(of(LIST_PANE), [...lists].sort()) && same(of(DETAIL_PANE), [...details].sort())
      && shown.every((leaf) => leaf.pane?.type === LIST_PANE || leaf.pane?.type === DETAIL_PANE);
  } catch {
    return false;
  }
}

const DETAIL_TAB_SET = new Set<string>(DETAIL_TABS);

function readFilters(raw: unknown): SessionFilters {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(NO_FILTERS).map(([key, fallback]) => [key, typeof saved[key] === 'string' ? saved[key] : fallback])) as unknown as SessionFilters;
}

function readDetail(raw: unknown): DetailState {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DetailState, unknown>>;
  return {
    session: typeof saved.session === 'string' ? saved.session : '',
    tab: typeof saved.tab === 'string' && DETAIL_TAB_SET.has(saved.tab) ? saved.tab as DetailTab : 'activity',
    eventFilter: typeof saved.eventFilter === 'string' ? saved.eventFilter : 'all',
  };
}

// ============================================================
// Store
// ============================================================

export function createJournalStore({ storage, name }: JournalStoreOptions): JournalStore {
  return create<JournalState>()(
    persist(
      (set, get) => {
        /** The detail pane a click shows its session in: the one focused last, else the first. */
        const targetDetail = () => {
          const state = get();
          return state.details[state.lastDetail] ? state.lastDetail : detailPanes(state)[0] ?? null;
        };
        /** A new detail pane beside `next` (a detail pane, or the list when there is none). */
        const openDetail = (beside: string, session: string, tab: DetailTab) => {
          const id = newId('detail');
          const state = get();
          set({
            details: { ...state.details, [id]: { ...newDetail(session), tab } },
            layout: splitLeaf(state.layout, beside, 'row', 'after', detailLeaf(id), `split-${id}`),
            focused: id,
            lastDetail: id,
          });
          return id;
        };

        return {
          enabled: null,
          snapshot: EMPTY_SNAPSHOT,
          stamp: '',
          busy: false,
          error: '',
          layout: defaultLayout(),
          lists: { [MAIN_LIST]: NO_FILTERS },
          details: { [MAIN_DETAIL]: newDetail() },
          focused: MAIN_LIST,
          lastList: MAIN_LIST,
          lastDetail: MAIN_DETAIL,
          evidence: {},
          zoom: {},

          setEnabled: (enabled) => set({ enabled }),
          setError: (error) => { if (get().error !== error) set({ error }); },
          setBusy: (busy) => set({ busy }),
          receive: (snapshot, stamp = '') => {
            const first = snapshot.sessions[0] ? sessionKey(snapshot.sessions[0]) : '';
            const target = targetDetail();
            const details = get().details;
            set({
              snapshot,
              stamp,
              error: '',
              ...(first && target && !details[target].session ? { details: { ...details, [target]: { ...details[target], session: first } } } : {}),
            });
          },
          forget: () => set({ enabled: false, snapshot: EMPTY_SNAPSHOT, stamp: '', evidence: {} }),

          setFilters: (list, filters) => set((state) => state.lists[list]
            ? { lists: { ...state.lists, [list]: { ...state.lists[list], ...filters } } }
            : state),
          clearFilters: (list) => set((state) => state.lists[list] ? { lists: { ...state.lists, [list]: NO_FILTERS } } : state),

          show: (key, options = {}) => {
            const target = targetDetail();
            const tab = options.tab;
            if (!target || options.side) {
              const beside = target ?? (get().lists[get().lastList] ? get().lastList : listPanes(get())[0]);
              return openDetail(beside, key, tab ?? (target ? get().details[target].tab : 'activity'));
            }
            const state = get();
            const evidence = { ...state.evidence };
            delete evidence[target];
            set({
              details: { ...state.details, [target]: { ...state.details[target], session: key, ...(tab ? { tab } : {}) } },
              evidence,
            });
            return target;
          },
          inspect: (key, event) => {
            const detail = get().show(key, { tab: 'activity' });
            set((state) => ({
              details: { ...state.details, [detail]: { ...state.details[detail], eventFilter: 'all' } },
              evidence: { ...state.evidence, [detail]: { session: key, event } },
              focused: detail,
              lastDetail: detail,
            }));
          },
          clearEvidence: (detail) => set((state) => {
            if (!state.evidence[detail]) return state;
            const evidence = { ...state.evidence };
            delete evidence[detail];
            return { evidence };
          }),
          setDetail: (detail, update) => set((state) => {
            const current = state.details[detail];
            if (!current) return state;
            const evidence = update.session !== undefined && update.session !== current.session ? (() => {
              const rest = { ...state.evidence };
              delete rest[detail];
              return rest;
            })() : state.evidence;
            return { details: { ...state.details, [detail]: { ...current, ...update } }, evidence };
          }),

          splitPane: (pane, dir) => {
            const state = get();
            const list = state.lists[pane];
            const detail = state.details[pane];
            if (!list && !detail) return null;
            const id = newId(list ? 'list' : 'detail');
            const leaf = list ? listLeaf(id) : detailLeaf(id);
            set({
              ...(list ? { lists: { ...state.lists, [id]: { ...list } }, lastList: id } : { details: { ...state.details, [id]: { ...detail } }, lastDetail: id }),
              // A copy beside it, at its zoom
              ...(state.zoom[pane] ? { zoom: { ...state.zoom, [id]: state.zoom[pane] } } : {}),
              layout: splitLeaf(state.layout, pane, dir, 'after', leaf, `split-${id}`),
              focused: id,
            });
            return id;
          },
          closePane: (pane) => {
            const state = get();
            const isList = !!state.lists[pane];
            const isDetail = !!state.details[pane];
            if (!isList && !isDetail) return;
            if (isList && listPanes(state).length === 1) return;
            if (isDetail && detailPanes(state).length === 1) return;
            const lists = { ...state.lists };
            const details = { ...state.details };
            const evidence = { ...state.evidence };
            const zoom = { ...state.zoom };
            delete lists[pane];
            delete details[pane];
            delete evidence[pane];
            delete zoom[pane];
            const layout = closeLeaf(state.layout, pane);
            const order = leaves(layout).map((leaf) => leaf.id);
            const lastList = lists[state.lastList] ? state.lastList : listPanes({ layout })[0];
            const lastDetail = details[state.lastDetail] ? state.lastDetail : detailPanes({ layout })[0];
            set({ lists, details, evidence, zoom, layout, lastList, lastDetail, focused: findLeaf(layout, state.focused) ? state.focused : order[0] });
          },
          focus: (pane) => {
            const state = get();
            if (!findLeaf(state.layout, pane)) return;
            const update: Partial<JournalState> = {};
            if (state.focused !== pane) update.focused = pane;
            if (state.details[pane] && state.lastDetail !== pane) update.lastDetail = pane;
            if (state.lists[pane] && state.lastList !== pane) update.lastList = pane;
            if (Object.keys(update).length) set(update);
          },
          resetLayout: () => {
            const state = get();
            set({
              layout: defaultLayout(),
              lists: { [MAIN_LIST]: state.lists[state.lastList] ?? NO_FILTERS },
              details: { [MAIN_DETAIL]: state.details[state.lastDetail] ?? newDetail() },
              evidence: {},
              zoom: Object.fromEntries([[MAIN_LIST, state.zoom[state.lastList]], [MAIN_DETAIL, state.zoom[state.lastDetail]]].filter(([, z]) => z)),
              focused: MAIN_LIST,
              lastList: MAIN_LIST,
              lastDetail: MAIN_DETAIL,
            });
          },
          setLayout: (layout) => {
            const state = get();
            if (layout !== state.layout && layoutFits(layout, Object.keys(state.lists), Object.keys(state.details))) set({ layout });
          },
          zoomPane: (pane, direction) => {
            const state = get();
            if (!state.lists[pane] && !state.details[pane]) return;
            const current = state.zoom[pane] ?? 100;
            const next = stepPaneZoom(current, direction);
            if (next === current) return;
            const zoom = { ...state.zoom };
            if (next === 100) delete zoom[pane];
            else zoom[pane] = next;
            set({ zoom });
          },
        };
      },
      {
        name,
        version: 1,
        storage: createJSONStorage(() => storage ?? NO_STORAGE),
        partialize: (state) => ({
          layout: state.layout,
          lists: state.lists,
          details: state.details,
          focused: state.focused,
          lastList: state.lastList,
          lastDetail: state.lastDetail,
          zoom: state.zoom,
        }),
        merge: (persistedState, current) => {
          const persisted = (persistedState ?? {}) as Partial<JournalState>;
          const lists = Object.fromEntries(Object.entries(persisted.lists ?? {}).map(([key, raw]) => [key, readFilters(raw)]));
          const details = Object.fromEntries(Object.entries(persisted.details ?? {}).map(([key, raw]) => [key, readDetail(raw)]));
          // A layout that doesn't fit its panes (an older version, an edit by hand) starts again
          if (!layoutFits(persisted.layout, Object.keys(lists), Object.keys(details))) return current;
          const layout = persisted.layout as LayoutNode;
          const pick = (saved: unknown, panes: Record<string, unknown>, fallback: string) =>
            typeof saved === 'string' && panes[saved] ? saved : fallback;
          return {
            ...current,
            layout,
            lists,
            details,
            focused: typeof persisted.focused === 'string' && findLeaf(layout, persisted.focused) ? persisted.focused : leaves(layout)[0].id,
            lastList: pick(persisted.lastList, lists, listPanes({ layout })[0]),
            lastDetail: pick(persisted.lastDetail, details, detailPanes({ layout })[0] ?? ''),
            zoom: readZoom(persisted.zoom, [...Object.keys(lists), ...Object.keys(details)]),
          };
        },
      },
    ),
  );
}

const NO_STORAGE: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
