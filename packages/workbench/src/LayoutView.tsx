import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SplitHandle, cx } from '@lambda-house/ui';
import {
  closeLeaf, findLeaf, fitLayout, isPx, joinLeaves, leaves, parentOf, resizeAt, revealLeaf, setPane, splitLeaf, swapPanes, toggleAt,
  type Layout, type LayoutNode, type Leaf, type Limits, type PaneRef, type Split,
} from './layout';
import { PaneContextProvider } from './panes';
import { focusedLeafOf, registerLayoutView, setFocusedPane, subscribeFocusedPane } from './focus';

/** A pane's own zoom (shared UI spec §5.4): Ctrl+wheel over it and the zoom commands go here. */
export interface PaneZoom {
  /** Percent. */
  get: (context: PaneContext) => number;
  /** 1 in, -1 out, 0 back to 100 %. */
  step: (context: PaneContext, direction: 1 | -1 | 0) => void;
  /** Where the zoom is kept tells about changes (a store); without it, it is read as the layout renders. */
  subscribe?: (listener: () => void) => () => void;
}

/** What a pane type needs from the layout (shared UI spec §5.4). */
export interface PaneType {
  type: string;
  /** Names the pane for its handle ("file panel"). */
  label?: string;
  /** Its name in its header and in menus ("Files"). */
  title?: string;
  /** Beside its name in the type menu and the pane menu: a 14 px icon. */
  icon?: ReactNode;
  /** Smallest width and height, px. */
  min?: { w?: number; h?: number };
  max?: { w?: number; h?: number };
  /** Can be collapsed: dragged below half its minimum, or by its handle's double-click. */
  collapsible?: boolean;
  /**
   * Expensive to recreate (a terminal, an editor): rendered once per key and
   * moved, never remounted, when the layout changes; kept while collapsed.
   */
  keepAlive?: boolean;
  /** Its header's title is a menu of the other switchable types: choosing one shows that pane in its place. */
  switchable?: boolean;
  /** At most one in the layout (Files, Contents); its key is its type. */
  singleton?: boolean;
  /** Its menu may close it (default: yes, while it is not the only pane); a function asks each time. */
  closable?: boolean | ((pane: PaneRef) => boolean);
  zoom?: PaneZoom;
  /** Split it as its owner does (a new document group), instead of adding a pane beside it to the layout. */
  split?: (context: PaneContext, dir: 'row' | 'col') => void;
  /** Close it as its owner does (asking about unsaved changes), instead of taking its leaf out of the layout. */
  close?: (context: PaneContext) => void;
  render: (context: PaneContext) => ReactNode;
}

/** What a pane's menu shows while one of its items is pointed at. */
export type PanePreview =
  | { kind: 'split'; dir: 'row' | 'col' }
  | { kind: 'join'; leaf: string }
  | { kind: 'swap'; leaf: string }
  | { kind: 'close' };

/** What can be done with a pane where it is: its menu, its type menu and its zoom read this. */
export interface PaneActions {
  /** Its name ("Files"). */
  title: string;
  canSplit: boolean;
  split: (dir: 'row' | 'col') => void;
  canClose: boolean;
  close: () => void;
  /** Panes next to it in its split that it can take the room of. */
  joinable: Array<{ leaf: string; title: string; icon?: ReactNode }>;
  join: (leaf: string) => void;
  /** The other panes, to trade places with. */
  swappable: Array<{ leaf: string; title: string; icon?: ReactNode }>;
  swap: (leaf: string) => void;
  /** Switchable types it can turn into here. */
  types: Array<{ type: string; title: string; icon?: ReactNode }>;
  setType: (type: string) => void;
  zoom: { get: () => number; step: (direction: 1 | -1 | 0) => void; subscribe?: (listener: () => void) => () => void } | null;
  /** Show what an item would do (null: stop). */
  preview: (preview: PanePreview | null) => void;
}

export interface PaneContext {
  pane: PaneRef;
  /** The leaf showing it; null for a kept-alive pane no leaf shows. */
  leaf: Leaf | null;
  focused: boolean;
  /** In a leaf that is not collapsed. */
  visible: boolean;
  /** Replace the pane's own state (`PaneRef.state`). */
  setState: (state: unknown) => void;
  actions: PaneActions;
}

export interface LayoutViewProps {
  layout: Layout;
  /** Handles were dragged, stepped or toggled; a pane was split, closed, joined, swapped or switched. */
  onChange: (layout: Layout) => void;
  paneTypes: Record<string, PaneType>;
  /** A leaf without a pane. */
  renderEmpty?: (leaf: Leaf, focused: boolean) => ReactNode;
  /** The layout's current leaf (`is-focused`): the one its owner acts on, which stays when the window's focus moves to another layout. */
  focusedLeaf?: string;
  onFocusLeaf?: (leafId: string) => void;
  /** Kept-alive panes to keep mounted although no leaf shows them (a terminal not in a pane); they wait in a hidden element beside the layout. */
  retain?: PaneRef[];
  /** Put the layout back as it first was (the layout.reset command); without it, the command looks to a layout around this one. */
  onReset?: () => void;
  className?: string;
}

const DEFAULT_MIN = 80;

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++counter).toString(36)}`;

/** A leaf's slot for a kept-alive pane: the pane's own element is moved in while it is here. */
function KeepAliveSlot({ element, parking }: { element: HTMLElement; parking: () => HTMLElement | null }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const here = slot.current;
    if (!here) return;
    here.appendChild(element);
    return () => {
      if (element.parentNode === here) parking()?.appendChild(element);
    };
  }, [element, parking]);
  return <div ref={slot} className="wb-slot" />;
}

/** Where a preview is drawn: over the leaf, or the half of it a split would give the new pane. */
function previewBox(rect: DOMRect, part: 'all' | 'right' | 'bottom'): CSSProperties {
  if (part === 'right') return { top: rect.top, left: rect.left + rect.width / 2, width: rect.width / 2, height: rect.height };
  if (part === 'bottom') return { top: rect.top + rect.height / 2, left: rect.left, width: rect.width, height: rect.height / 2 };
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * Draws a layout tree: splits as flex rows and columns with a SplitHandle
 * between children, leaves with their pane. Pixel children keep their width
 * when the window changes; fractional ones share the rest down to their
 * minimum. Every pane gets its context (usePane): its menu's actions on this
 * layout, its zoom. Ctrl+wheel over a pane zooms it.
 */
export function LayoutView({ layout, onChange, paneTypes, renderEmpty, focusedLeaf, onFocusLeaf, retain = [], onReset, className }: LayoutViewProps) {
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const childRefs = useRef(new Map<string, HTMLElement>());
  const leafRefs = useRef(new Map<string, HTMLElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const parkingRef = useRef<HTMLDivElement>(null);
  const parking = useCallback(() => parkingRef.current, []);
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const drag = useRef<{ base: Layout; measured: number[] } | null>(null);
  const [preview, setPreview] = useState<{ leaf: string; what: PanePreview } | null>(null);
  const viewId = useId();

  // Pointing at or focusing something in a leaf makes it the focused pane. The listeners are the
  // DOM's: a kept-alive pane's content is a portal, whose React events don't pass through its leaf.
  // Outer leaves hear it first, so the innermost pane wins.
  const focusOwner = useRef({ focusedLeaf, onFocusLeaf });
  focusOwner.current = { focusedLeaf, onFocusLeaf };
  const [leafRefCallbacks] = useState(() => new Map<string, (element: HTMLElement | null) => (() => void) | undefined>());
  const leafRef = (id: string) => {
    let callback = leafRefCallbacks.get(id);
    if (!callback) {
      callback = (element) => {
        if (!element) return;
        leafRefs.current.set(id, element);
        const take = () => {
          setFocusedPane(viewId, id);
          if (focusOwner.current.focusedLeaf !== id) focusOwner.current.onFocusLeaf?.(id);
        };
        element.addEventListener('pointerdown', take, true);
        element.addEventListener('focusin', take, true);
        return () => {
          if (leafRefs.current.get(id) === element) leafRefs.current.delete(id);
          if (leafRefCallbacks.get(id) === callback) leafRefCallbacks.delete(id);
          element.removeEventListener('pointerdown', take, true);
          element.removeEventListener('focusin', take, true);
        };
      };
      leafRefCallbacks.set(id, callback);
    }
    return callback;
  };

  const elementFor = (key: string) => {
    let element = elements.get(key);
    if (!element) {
      element = document.createElement('div');
      element.className = 'wb-keepalive';
      elements.set(key, element);
    }
    return element;
  };

  const limitsOf = (node: LayoutNode, dir: 'row' | 'col'): Limits => {
    if (node.kind === 'split') return { min: 0 };
    const type = node.pane ? paneTypes[node.pane.type] : undefined;
    const axis = dir === 'row' ? 'w' : 'h';
    return { min: type?.min?.[axis] ?? DEFAULT_MIN, max: type?.max?.[axis], collapsible: type?.collapsible };
  };

  // A window too small for the panes (spec §5.3): drawn fitted, never saved. The fit is worked
  // out as the layout's room changes, and the layout draws again only when the fit changes.
  const leafLimits = (leaf: Leaf, dir: 'row' | 'col') => limitsOf(leaf, dir);
  const room = useRef<{ w: number; h: number } | null>(null);
  const fitOf = (root: LayoutNode) => (room.current && room.current.w > 0 && room.current.h > 0 ? fitLayout(root, room.current, leafLimits) : root);
  const [fitVersion, setFitVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fitted = useMemo(() => fitOf(layout.root), [layout.root, paneTypes, fitVersion]);
  const fitting = useRef({ fitted, fitOf });
  fitting.current = { fitted, fitOf };
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measureRoom = () => {
      room.current = { w: element.clientWidth, h: element.clientHeight };
      const { fitted: drawn, fitOf: fit } = fitting.current;
      if (JSON.stringify(fit(latestLayout.current.root)) !== JSON.stringify(drawn)) setFitVersion((v) => v + 1);
    };
    measureRoom();
    const observer = new ResizeObserver(measureRoom);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const measure = (split: Split) => split.children.map((child) => {
    const element = childRefs.current.get(child.id);
    return element ? (split.dir === 'row' ? element.offsetWidth : element.offsetHeight) : 0;
  });

  const childStyle = (split: Split, index: number): CSSProperties => {
    const child = split.children[index];
    const size = split.sizes[index];
    if (child.kind === 'leaf' && child.collapsed) return { flex: '0 0 0px' };
    if (isPx(size)) return { flex: `0 0 ${size.px}px` };
    const min = limitsOf(child, split.dir).min;
    return { flex: `${size.fr} 1 0px`, [split.dir === 'row' ? 'minWidth' : 'minHeight']: child.kind === 'leaf' ? min : undefined };
  };

  // ============================================================
  // Panes: their context and what their menus do
  // ============================================================

  const allLeaves = leaves(layout.root);
  const titleOf = (pane: PaneRef | null) => (pane ? paneTypes[pane.type]?.title ?? paneTypes[pane.type]?.label ?? pane.type : 'Empty');
  const iconOf = (pane: PaneRef | null) => (pane ? paneTypes[pane.type]?.icon : undefined);
  /** Leaf titles, numbered where two read the same. */
  const titles = new Map<string, string>();
  {
    const seen = new Map<string, number>();
    for (const leaf of allLeaves) seen.set(titleOf(leaf.pane), (seen.get(titleOf(leaf.pane)) ?? 0) + 1);
    const count = new Map<string, number>();
    for (const leaf of allLeaves) {
      const title = titleOf(leaf.pane);
      const n = (count.get(title) ?? 0) + 1;
      count.set(title, n);
      titles.set(leaf.id, (seen.get(title) ?? 0) > 1 ? `${title} ${n}` : title);
    }
  }
  const change = (root: LayoutNode) => { if (root !== layout.root) onChange({ ...layout, root }); };

  /** The pane a split adds: another switchable one not shown yet, or one more of a type that may repeat. */
  const nextPane = (pane: PaneRef): PaneRef | null => {
    const type = paneTypes[pane.type];
    const shown = new Set(allLeaves.map((leaf) => leaf.pane?.type));
    if (type?.switchable) {
      const other = Object.values(paneTypes).find((t) => t.switchable && !(t.singleton && shown.has(t.type)));
      return other ? { type: other.type, key: other.singleton ? other.type : newId(other.type) } : null;
    }
    return type && !type.singleton ? { type: type.type, key: newId(type.type) } : null;
  };

  const isClosable = (pane: PaneRef): boolean => {
    const closable = paneTypes[pane.type]?.closable;
    return typeof closable === 'function' ? closable(pane) : closable !== false;
  };

  const contextFor = (pane: PaneRef, leaf: Leaf | null): PaneContext => {
    const type = paneTypes[pane.type];
    const focused = !!leaf && leaf.id === focusedLeaf;
    const visible = !!leaf && !leaf.collapsed;
    const context: PaneContext = { pane, leaf, focused, visible, setState: () => {}, actions: undefined as unknown as PaneActions };
    context.setState = (state) => { if (leaf) change(setPane(layout.root, leaf.id, { ...pane, state })); };
    const place = leaf ? parentOf(layout.root, leaf.id) : undefined;
    const neighbours = place ? [place.index - 1, place.index + 1]
      .map((i) => place.split.children[i])
      .filter((node): node is Leaf => node?.kind === 'leaf' && !!node.pane && isClosable(node.pane)) : [];
    const shownTypes = new Set(allLeaves.filter((l) => l !== leaf).map((l) => l.pane?.type));
    const fresh = leaf ? nextPane(pane) : null;
    const canClose = !!leaf && allLeaves.length > 1 && isClosable(pane);
    const closeOther = (other: Leaf) => {
      const otherType = other.pane ? paneTypes[other.pane.type] : undefined;
      if (otherType?.close && other.pane) otherType.close(contextFor(other.pane, other));
      else if (leaf) change(joinLeaves(layout.root, leaf.id, other.id));
    };
    context.actions = {
      title: leaf ? titles.get(leaf.id) ?? titleOf(pane) : titleOf(pane),
      canSplit: !!leaf && (!!type?.split || !!fresh),
      split: (dir) => {
        if (!leaf) return;
        if (type?.split) { type.split(context, dir); return; }
        if (!fresh) return;
        const id = newId('leaf');
        change(splitLeaf(layout.root, leaf.id, dir, 'after', { kind: 'leaf', id, pane: fresh }, newId('split')));
        onFocusLeaf?.(id);
      },
      canClose,
      close: () => {
        if (!canClose || !leaf) return;
        if (type?.close) type.close(context);
        else change(closeLeaf(layout.root, leaf.id));
      },
      joinable: neighbours.map((other) => ({ leaf: other.id, title: titles.get(other.id) ?? titleOf(other.pane), icon: iconOf(other.pane) })),
      join: (other) => {
        const target = neighbours.find((n) => n.id === other);
        if (target) closeOther(target);
      },
      swappable: leaf ? allLeaves.filter((other) => other !== leaf).map((other) => ({ leaf: other.id, title: titles.get(other.id) ?? titleOf(other.pane), icon: iconOf(other.pane) })) : [],
      swap: (other) => { if (leaf) change(swapPanes(layout.root, leaf.id, other)); },
      types: leaf && type?.switchable
        ? Object.values(paneTypes)
          .filter((t) => t.switchable && t.type !== pane.type && !(t.singleton && shownTypes.has(t.type)))
          .map((t) => ({ type: t.type, title: t.title ?? t.label ?? t.type, icon: t.icon }))
        : [],
      setType: (next) => {
        const nextType = paneTypes[next];
        if (!leaf || !nextType?.switchable) return;
        change(setPane(layout.root, leaf.id, { type: next, key: nextType.singleton ? next : newId(next) }));
      },
      zoom: type?.zoom ? {
        get: () => type.zoom!.get(context),
        step: (direction) => type.zoom!.step(context, direction),
        subscribe: type.zoom.subscribe,
      } : null,
      preview: (what) => setPreview(what && leaf ? { leaf: leaf.id, what } : null),
    };
    return context;
  };

  // The menu of a pane that is gone takes its preview with it
  useEffect(() => {
    if (preview && !findLeaf(layout.root, preview.leaf)) setPreview(null);
  }, [layout.root, preview]);

  // Ctrl+wheel zooms the pane under the pointer (an inner layout's pane first)
  const latest = useRef({ layout, contextFor, onReset });
  latest.current = { layout, contextFor, onReset };

  // Commands find the focused pane through the window's focus registry
  const hasReset = !!onReset;
  // The leaf with the window's focus carries the focus line (where F6 went, what commands act on)
  const windowFocus = useSyncExternalStore(subscribeFocusedPane, () => focusedLeafOf(viewId));
  // The owner moved its current leaf (a split, a pane it opened something in) while the window's
  // focus was in this layout: the focus goes with it
  useEffect(() => {
    const current = focusedLeafOf(viewId);
    if (focusedLeaf && current && current !== focusedLeaf && findLeaf(layout.root, focusedLeaf)) setFocusedPane(viewId, focusedLeaf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedLeaf]);
  useEffect(() => registerLayoutView(viewId, {
    resolve: (id) => {
      const leaf = findLeaf(latest.current.layout.root, id);
      return leaf?.pane ? latest.current.contextFor(leaf.pane, leaf) : null;
    },
    reset: hasReset ? () => latest.current.onReset?.() : undefined,
  }), [viewId, hasReset]);
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
      // The nearest leaf of this layout (an inner layout's leaves carry its own id)
      let leafElement = e.target instanceof Element ? e.target : null;
      while (leafElement && leafElement !== element && leafElement.getAttribute('data-layout') !== viewId) leafElement = leafElement.parentElement;
      const leaf = leafElement && leafElement !== element ? findLeaf(latest.current.layout.root, leafElement.getAttribute('data-leaf') ?? '') : undefined;
      const zoom = leaf?.pane && latest.current.contextFor(leaf.pane, leaf).actions.zoom;
      if (!zoom) return;
      e.preventDefault();
      e.stopPropagation();
      zoom.step(e.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [viewId]);

  // ============================================================
  // Drawing
  // ============================================================

  const renderLeaf = (leaf: Leaf) => {
    const focused = leaf.id === focusedLeaf;
    const type = leaf.pane ? paneTypes[leaf.pane.type] : undefined;
    let content: ReactNode = null;
    if (!leaf.pane || !type) content = leaf.collapsed ? null : renderEmpty?.(leaf, focused) ?? null;
    else if (type.keepAlive) content = <KeepAliveSlot element={elementFor(leaf.pane.key)} parking={parking} />;
    else if (!leaf.collapsed) {
      const context = contextFor(leaf.pane, leaf);
      content = <PaneContextProvider value={context}>{type.render(context)}</PaneContextProvider>;
    }
    return (
      <div
        className={cx('wb-leaf', focused && 'is-focused', leaf.id === windowFocus && 'has-focus', leaf.collapsed && 'is-collapsed')}
        data-leaf={leaf.id}
        data-layout={viewId}
        ref={leafRef(leaf.id)}
      >
        {content}
      </div>
    );
  };

  const renderNode = (node: LayoutNode): ReactNode => {
    if (node.kind === 'leaf') return renderLeaf(node);
    const limits = node.children.map((child) => limitsOf(child, node.dir));
    const label = (index: number) => {
      const child = node.children[index];
      const type = child.kind === 'leaf' && child.pane ? paneTypes[child.pane.type] : undefined;
      return type?.label ?? 'pane';
    };
    return (
      <div className={`wb-split wb-split--${node.dir}`} data-split={node.id}>
        {node.children.map((child, index) => {
          const before = node.children[index - 1];
          const collapsed = index === 0 ? null
            : before.kind === 'leaf' && before.collapsed ? 'before'
            : child.kind === 'leaf' && child.collapsed ? 'after'
            : null;
          const divider = index - 1;
          // The handle is named after the collapsible pane beside it
          const named = limits[divider]?.collapsible ? divider : index;
          return (
            <Fragment key={child.id}>
              {index > 0 && (
                <SplitHandle
                  orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
                  collapsed={collapsed}
                  label={label(named)}
                  onDragStart={() => { drag.current = { base: layout, measured: measure(node) }; }}
                  onDrag={(delta) => {
                    const start = drag.current;
                    if (start) onChange({ ...start.base, root: resizeAt(start.base.root, node.id, divider, delta, start.measured, limits) });
                  }}
                  onDragEnd={() => { drag.current = null; }}
                  onStep={(delta) => onChange({ ...layout, root: resizeAt(layout.root, node.id, divider, delta, measure(node), limits) })}
                  onToggle={() => {
                    // A pane the window had no room for: the others give way for it
                    const squeezed = [before, child].find((c) => c.kind === 'leaf' && c.collapsed && !findLeaf(layout.root, c.id)?.collapsed);
                    if (squeezed && room.current) onChange({ ...layout, root: revealLeaf(layout.root, squeezed.id, room.current, leafLimits) });
                    else onChange({ ...layout, root: toggleAt(layout.root, node.id, divider, limits) });
                  }}
                />
              )}
              <div
                className="wb-split__child"
                style={childStyle(node, index)}
                ref={(element) => { if (element) childRefs.current.set(child.id, element); else childRefs.current.delete(child.id); }}
              >
                {renderNode(child)}
              </div>
            </Fragment>
          );
        })}
      </div>
    );
  };

  // Every kept-alive pane: the ones in leaves, and the retained ones
  const shown = allLeaves.filter((leaf) => leaf.pane && paneTypes[leaf.pane.type]?.keepAlive);
  const kept = new Map<string, { pane: PaneRef; leaf: Leaf | null }>();
  for (const leaf of shown) kept.set(leaf.pane!.key, { pane: leaf.pane!, leaf });
  for (const pane of retain) if (!kept.has(pane.key) && paneTypes[pane.type]?.keepAlive) kept.set(pane.key, { pane, leaf: null });
  for (const key of [...elements.keys()]) if (!kept.has(key)) elements.delete(key);

  // A retained pane no leaf shows waits, mounted, in the parking
  useLayoutEffect(() => {
    for (const [key, { leaf }] of kept) {
      const element = elements.get(key);
      if (!leaf && element && !element.isConnected) parkingRef.current?.appendChild(element);
    }
  });

  // What a pane's menu item would do, drawn over the panes it concerns
  const overlays = useMemo(() => {
    if (!preview) return [];
    const rect = (id: string) => leafRefs.current.get(id)?.getBoundingClientRect();
    const { leaf, what } = preview;
    const own = rect(leaf);
    if (!own) return [];
    if (what.kind === 'split') return [{ key: 'split', className: 'wb-preview--add', style: previewBox(own, what.dir === 'row' ? 'right' : 'bottom') }];
    if (what.kind === 'close') return [{ key: 'close', className: 'wb-preview--remove', style: previewBox(own, 'all') }];
    const other = rect(what.leaf);
    if (!other) return [];
    return what.kind === 'join'
      ? [{ key: 'join', className: 'wb-preview--remove', style: previewBox(other, 'all') }, { key: 'keep', className: 'wb-preview--add', style: previewBox(own, 'all') }]
      : [{ key: 'a', className: 'wb-preview--swap', style: previewBox(own, 'all') }, { key: 'b', className: 'wb-preview--swap', style: previewBox(other, 'all') }];
  }, [preview]);

  // The parking is beside the tree, not in it: a class given to the layout covers only what is shown
  return (
    <>
      <div ref={rootRef} className={cx('wb-layout', className)} data-view={viewId}>{renderNode(fitted)}</div>
      <div ref={parkingRef} className="wb-parking" aria-hidden="true" />
      {overlays.map((overlay) => <div key={overlay.key} className={cx('wb-preview', overlay.className)} style={overlay.style} aria-hidden="true" />)}
      {[...kept.entries()].map(([key, { pane, leaf }]) => {
        const context = contextFor(pane, leaf);
        return createPortal(
          <PaneContextProvider value={context}>{paneTypes[pane.type].render(context)}</PaneContextProvider>,
          elementFor(key),
          key,
        );
      })}
    </>
  );
}
