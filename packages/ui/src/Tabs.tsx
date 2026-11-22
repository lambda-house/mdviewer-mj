import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  /** A small count after the label. */
  count?: ReactNode;
}

export interface TabsProps<V extends string> {
  /** Names the tab list for screen readers ("Session details"). */
  label: string;
  tabs: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** id prefix: tab `${idPrefix}-${value}` controls panel `${idPrefix}-${value}-panel`. */
  idPrefix?: string;
  className?: string;
}

/**
 * A tab strip (role=tablist). Arrow keys, Home and End move between tabs and
 * select them; only the selected tab is in the Tab order.
 */
export function Tabs<V extends string>({ label, tabs, value, onChange, idPrefix, className }: TabsProps<V>) {
  const list = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.value === value);
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].value);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={list} className={cx('ui-tabs', className)} role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-${tab.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-${tab.value}-panel` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ui-tabs__tab"
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ui-tabs__count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
