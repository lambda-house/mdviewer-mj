import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
}

export interface SegmentedProps<V extends string> {
  /** Names the group for screen readers ("Workspace", "File filter"). */
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /**
   * nav: switches between places (a nav with aria-current, Tab reaches every
   * option); choice: picks a value (a radio group, arrow keys move the choice).
   */
  kind?: 'nav' | 'choice';
  /** The options share the full width. */
  fill?: boolean;
  className?: string;
}

/** A row of mutually exclusive options: Documents | Sessions, Files | Agents, Live | Journal. */
export function Segmented<V extends string>({ label, options, value, onChange, kind = 'nav', fill = false, className }: SegmentedProps<V>) {
  const group = useRef<HTMLDivElement>(null);
  const classes = cx('ui-segmented', fill && 'ui-segmented--fill', className);

  const buttons = options.map((option) => {
    const selected = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        className="ui-segmented__option"
        title={option.title}
        onClick={() => onChange(option.value)}
        {...(kind === 'nav'
          ? { 'aria-current': selected ? ('page' as const) : undefined }
          : { role: 'radio', 'aria-checked': selected, tabIndex: selected ? 0 : -1 })}
      >
        {option.icon && <span className="ui-segmented__icon" aria-hidden="true">{option.icon}</span>}
        {option.label}
      </button>
    );
  });

  if (kind === 'nav') {
    return <nav className={classes} aria-label={label}>{buttons}</nav>;
  }

  // Radio group: arrows move the choice and the focus with it
  const handleKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return <div ref={group} className={classes} role="radiogroup" aria-label={label} onKeyDown={handleKeyDown}>{buttons}</div>;
}
