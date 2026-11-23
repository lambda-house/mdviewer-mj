import { Fragment, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SplitHandle, cx } from '@lambda-house/ui';
import { isPx, leaves, resizeAt, toggleAt, type Layout, type LayoutNode, type Leaf, type Limits, type PaneRef, type Split } from './layout';

/** What a pane type needs from the layout (shared UI spec §5.4). */
export interface PaneType {
  type: string;
  /** Names the pane for its handle ("file panel"). */
  label?: string;
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
  render: (context: PaneContext) => ReactNode;
}

export interface PaneContext {
  pane: PaneRef;
  /** The leaf showing it; null for a kept-alive pane no leaf shows. */
  leaf: Leaf | null;
  focused: boolean;
  /** In a leaf that is not collapsed. */
  visible: boolean;
}

export interface LayoutViewProps {
  layout: Layout;
  /** Handles were dragged, stepped or toggled. */
  onChange: (layout: Layout) => void;
  paneTypes: Record<string, PaneType>;
  /** A leaf without a pane. */
  renderEmpty?: (leaf: Leaf, focused: boolean) => ReactNode;
  focusedLeaf?: string;
  onFocusLeaf?: (leafId: string) => void;
  /** Kept-alive panes to keep mounted although no leaf shows them (a terminal not in a pane). */
  retain?: PaneRef[];
  className?: string;
}

const DEFAULT_MIN = 80;

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

/**
 * Draws a layout tree: splits as flex rows and columns with a SplitHandle
 * between children, leaves with their pane. Pixel children keep their width
 * when the window changes; fractional ones share the rest down to their
 * minimum.
 */
export function LayoutView({ layout, onChange, paneTypes, renderEmpty, focusedLeaf, onFocusLeaf, retain = [], className }: LayoutViewProps) {
  const childRefs = useRef(new Map<string, HTMLElement>());
  const parkingRef = useRef<HTMLDivElement>(null);
  const parking = useCallback(() => parkingRef.current, []);
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const drag = useRef<{ base: Layout; measured: number[] } | null>(null);

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

  const renderLeaf = (leaf: Leaf) => {
    const focused = leaf.id === focusedLeaf;
    const type = leaf.pane ? paneTypes[leaf.pane.type] : undefined;
    let content: ReactNode = null;
    if (!leaf.pane || !type) content = leaf.collapsed ? null : renderEmpty?.(leaf, focused) ?? null;
    else if (type.keepAlive) content = <KeepAliveSlot element={elementFor(leaf.pane.key)} parking={parking} />;
    else if (!leaf.collapsed) content = type.render({ pane: leaf.pane, leaf, focused, visible: true });
    return (
      <div
        className={cx('wb-leaf', focused && 'is-focused', leaf.collapsed && 'is-collapsed')}
        data-leaf={leaf.id}
        onPointerDownCapture={() => { if (!focused) onFocusLeaf?.(leaf.id); }}
        onFocusCapture={() => { if (!focused) onFocusLeaf?.(leaf.id); }}
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
                  onToggle={() => onChange({ ...layout, root: toggleAt(layout.root, node.id, divider, limits) })}
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
  const shown = leaves(layout.root).filter((leaf) => leaf.pane && paneTypes[leaf.pane.type]?.keepAlive);
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

  return (
    <div className={cx('wb-layout', className)}>
      {renderNode(layout.root)}
      <div ref={parkingRef} className="wb-parking" aria-hidden="true" />
      {[...kept.entries()].map(([key, { pane, leaf }]) => createPortal(
        paneTypes[pane.type].render({
          pane,
          leaf,
          focused: !!leaf && leaf.id === focusedLeaf,
          visible: !!leaf && !leaf.collapsed,
        }),
        elementFor(key),
        key,
      ))}
    </div>
  );
}
