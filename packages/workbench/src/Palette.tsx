import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Search, TerminalSquare, X } from 'lucide-react';
import { Kbd, ScrollArea, cx } from '@lambda-house/ui';
import { formatShortcut, menuEntries, type MenuItem } from './commands';

export interface PaletteItem {
  id: string;
  /** The heading the item is listed under ("Commands", "Open tabs"). */
  group: string;
  label: string;
  /** Short text at the right of the row. */
  hint?: string;
  icon?: ReactNode;
  /** The key that runs it, as written ("⇧⌘S"). */
  shortcut?: string;
  /** The app's own row instead of icon, label and hint (a session row). */
  row?: ReactNode;
  /** Extra class of the option, for the app's own row. */
  className?: string;
  /** Shown above the row, outside the option (a folder over its sessions). */
  heading?: ReactNode;
  /** The option's accessible name, when the row's text doesn't say enough. */
  ariaLabel?: string;
  /** The side panel while this item is selected. */
  preview?: ReactNode;
  run: () => void;
}

export interface PaletteProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** The items for the query; the app filters them. */
  items: PaletteItem[];
  /** The order of the groups; others follow in the order they first appear. */
  groups?: string[];
  /** Names the palette for screen readers. */
  label?: string;
  placeholder?: string;
  /** Under the search field: the app's filters. */
  toolbar?: ReactNode;
  /** Show a side panel with the selected item's preview (the item's own, or its group, label and hint). */
  showPreview?: boolean;
  /** The side panel when nothing is selected. */
  emptyPreview?: ReactNode;
}

/** The default side panel: the item's group, label and hint. */
function DefaultPreview({ item }: { item: PaletteItem }) {
  return (
    <>
      <div className="cmd-preview__head"><span className="cmd-preview__brand">{item.group}</span></div>
      <h3 className="cmd-preview__title">{item.label}</h3>
      {item.hint && <p className="cmd-preview__text">{item.hint}</p>}
      <div className="cmd-preview__footer"><Kbd>↵</Kbd> Run</div>
    </>
  );
}

/**
 * The command palette: a search field over grouped results. ↑ and ↓ move,
 * Enter runs the selected item (the palette closes first), Escape closes.
 * Drawn over the window, in the page's body.
 */
export function Palette({
  open, onClose, query, onQueryChange, items, groups: groupOrder = [], label = 'Command palette',
  placeholder = 'Search commands…', toolbar, showPreview = false, emptyPreview,
}: PaletteProps) {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  // Opening selects the first item and focuses the field
  useEffect(() => {
    if (!open) return;
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const groups = useMemo(() => {
    const names = [...groupOrder, ...items.map((item) => item.group)].filter((name, i, all) => all.indexOf(name) === i);
    return names
      .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [items, groupOrder]);

  const flat = useMemo(() => groups.flatMap((entry) => entry.items), [groups]);
  const index = flat.length > 0 ? Math.min(active, flat.length - 1) : 0;
  const activeItem = flat[index];

  useEffect(() => {
    if (!open || !activeItem) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index, activeItem]);

  if (!open) return null;

  const choose = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Modal: keys don't reach the app's shortcuts
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(flat.length ? (index + step + flat.length) % flat.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeItem) choose(activeItem);
    }
  };

  return createPortal(
    <div className="cmd-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cmd-panel" role="dialog" aria-modal="true" aria-label={label} onKeyDown={handleKeyDown}>
        <div className="cmd-search">
          <span className="cmd-search__icon" aria-hidden="true"><Search size={16} /></span>
          <input
            ref={inputRef}
            className="cmd-search__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeItem ? `${id}-${activeItem.id}` : undefined}
            aria-autocomplete="list"
            aria-label={placeholder.replace(/…$/, '')}
            placeholder={placeholder}
            value={query}
            onChange={(event) => { onQueryChange(event.target.value); setActive(0); }}
          />
          {query && (
            <button type="button" className="cmd-search__clear" aria-label="Clear search"
              onClick={() => { onQueryChange(''); setActive(0); inputRef.current?.focus(); }}>
              <X size={14} />
            </button>
          )}
        </div>

        {toolbar && <div className="cmd-subbar">{toolbar}</div>}

        <div className={cx('cmd-body', !showPreview && 'cmd-body--list')}>
          <div className="cmd-list-wrap">
            <ScrollArea
              autoHeight
              maxHeight="calc(min(78vh, 720px) - 144px)"
              style={{ flex: 'none' }}
              viewRef={listRef as Ref<HTMLElement>}
              viewProps={{ className: 'cmd-list', id: listId, role: 'listbox', 'aria-label': 'Results' }}
            >
              {groups.map((entry) => (
                <div key={entry.group} className="cmd-group" role="group" aria-label={entry.group}>
                  <div className="cmd-group__head" aria-hidden="true">
                    <span className="cmd-group__label">{entry.group}</span>
                    <span className="cmd-group__count">{entry.items.length}</span>
                  </div>
                  {entry.items.map((item) => {
                    const itemIndex = flat.indexOf(item);
                    const isActive = itemIndex === index;
                    const enter = <span className="cmd-item__enter" aria-hidden="true"><Kbd>↵</Kbd></span>;
                    return (
                      <Fragment key={item.id}>
                        {item.heading}
                        <div
                          id={`${id}-${item.id}`}
                          data-index={itemIndex}
                          role="option"
                          aria-selected={isActive}
                          aria-label={item.ariaLabel}
                          className={cx('cmd-item', isActive && 'cmd-item--active', item.className)}
                          onMouseMove={() => setActive(itemIndex)}
                          onClick={() => choose(item)}
                        >
                          {item.row ?? (
                            <>
                              <span className="cmd-item__icon" aria-hidden="true">{item.icon ?? <TerminalSquare size={14} />}</span>
                              <span className="cmd-item__main"><span className="cmd-item__label">{item.label}</span></span>
                              <span className="cmd-item__right">
                                {item.hint && <span className="cmd-item__hint">{item.hint}</span>}
                                {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                              </span>
                            </>
                          )}
                          {enter}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              ))}
              {flat.length === 0 && (
                <div className="cmd-empty">
                  {query ? <>Nothing matches <span className="cmd-empty__query">“{query}”</span></> : 'Nothing to show'}
                </div>
              )}
            </ScrollArea>
          </div>

          {showPreview && (
            <aside className="cmd-preview" aria-label="Selection preview">
              {activeItem ? (activeItem.preview ?? <DefaultPreview item={activeItem} />) : emptyPreview}
            </aside>
          )}
        </div>

        <div className="cmd-foot" aria-hidden="true">
          <div className="cmd-foot__group">
            <span className="cmd-foot__keys"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
            <span className="cmd-foot__keys"><Kbd>↵</Kbd> open</span>
            <span className="cmd-foot__keys"><Kbd>esc</Kbd> close</span>
          </div>
          <span>{flat.length} results</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Whether every word of the query is in one of the texts (case-insensitive). */
export function matchesQuery(query: string, ...texts: Array<string | undefined>): boolean {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/**
 * The menu's commands as palette items: those the palette may list and that
 * are enabled now, matching the query by label or submenu.
 */
export function commandItems<C>(menu: MenuItem<C>[], context: C, query: string, group = 'Commands'): PaletteItem[] {
  return menuEntries(menu)
    .filter(({ command }) => command.palette !== false && command.enabled?.(context) !== false)
    .filter(({ command, submenu }) => matchesQuery(query, command.label, submenu))
    .map(({ command, submenu }) => ({
      id: `command:${command.id}`,
      group,
      label: command.label,
      hint: submenu || undefined,
      shortcut: command.shortcut ? formatShortcut(command.shortcut) : undefined,
      run: command.run,
    }));
}
