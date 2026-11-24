import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { cx } from '@lambda-house/ui';
import { formatShortcut, isSubmenu, type Command, type MenuItem, onSurface } from './commands';

/**
 * How long an open submenu stays when the pointer moves to another row (ms):
 * on its way to the submenu the pointer usually crosses the rows below.
 */
const SUBMENU_SWITCH_DELAY = 250;

// ============================================================
// Menu Popup
// ============================================================

interface MenuPopupProps<C> {
  items: MenuItem<C>[];
  context: C;
  /** Opened from the keyboard: the first row starts highlighted. */
  highlightFirst: boolean;
  onClose: () => void;
  /** The shown surface: another surface's commands are disabled. */
  surface?: string;
}

/**
 * The open menu. The keyboard focus stays where it was (the editor, an
 * input), so it is still there once the menu closes; keys are caught on the
 * window instead.
 */
function MenuPopup<C>({ items, context, highlightFirst, onClose, surface }: MenuPopupProps<C>) {
  /** Highlighted row (-1: none). */
  const [activeIndex, setActiveIndex] = useState(highlightFirst ? 0 : -1);
  /** Row whose submenu is open. */
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  /** Highlighted row of the open submenu (-1: none, the keys move in the menu itself). */
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(-1);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isDisabled = (command: Command<C>) => !onSurface(command, surface) || command.enabled?.(context) === false;
  const canHighlight = (item: MenuItem<C>) =>
    item !== 'separator' && (isSubmenu(item) || !isDisabled(item));

  /** The next row to highlight, down (1) or up (-1) from `from`, wrapping around. */
  const step = (list: MenuItem<C>[], from: number, direction: 1 | -1): number => {
    const start = from === -1 && direction === -1 ? 0 : from;
    for (let n = 1; n <= list.length; n++) {
      const index = (((start + direction * n) % list.length) + list.length) % list.length;
      if (canHighlight(list[index])) return index;
    }
    return from;
  };

  const run = (command: Command<C>) => {
    if (isDisabled(command)) return;
    onClose();
    command.run();
  };

  const openSubmenu = (index: number) => {
    const item = items[index];
    if (!isSubmenu(item)) return;
    clearTimeout(switchTimer.current);
    setActiveIndex(index);
    setSubmenuIndex(index);
    setSubmenuActiveIndex(step(item.items, -1, 1));
  };

  const closeSubmenu = () => {
    clearTimeout(switchTimer.current);
    setSubmenuIndex(null);
    setSubmenuActiveIndex(-1);
  };

  // The highlight follows the pointer at once; an open submenu is replaced
  // only after a moment (see SUBMENU_SWITCH_DELAY)
  const hoverRow = (index: number) => {
    clearTimeout(switchTimer.current);
    setActiveIndex(index);
    if (index === submenuIndex) return;

    const showSubmenu = () => {
      setSubmenuIndex(isSubmenu(items[index]) ? index : null);
      setSubmenuActiveIndex(-1);
    };
    if (submenuIndex === null) showSubmenu();
    else switchTimer.current = setTimeout(showSubmenu, SUBMENU_SWITCH_DELAY);
  };

  useEffect(() => () => clearTimeout(switchTimer.current), []);

  // Keys while the menu is open. Subscribed on every render, so the handler
  // sees the current rows.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const openItem = submenuIndex !== null ? items[submenuIndex] : undefined;
      const submenu = openItem !== undefined && isSubmenu(openItem) ? openItem : null;
      const inSubmenu = submenu !== null && submenuActiveIndex !== -1;

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const direction = e.key === 'ArrowDown' ? 1 : -1;
          if (inSubmenu) {
            setSubmenuActiveIndex(step(submenu.items, submenuActiveIndex, direction));
          } else {
            closeSubmenu();
            setActiveIndex(step(items, activeIndex, direction));
          }
          break;
        }
        case 'Home':
        case 'End': {
          const direction = e.key === 'Home' ? 1 : -1;
          if (inSubmenu) {
            setSubmenuActiveIndex(step(submenu.items, -1, direction));
          } else {
            closeSubmenu();
            setActiveIndex(step(items, -1, direction));
          }
          break;
        }
        case 'ArrowRight':
          if (!inSubmenu && activeIndex !== -1) openSubmenu(activeIndex);
          break;
        case 'ArrowLeft':
          closeSubmenu();
          break;
        case 'Enter': {
          const item = inSubmenu ? submenu.items[submenuActiveIndex] : items[activeIndex];
          if (!item || item === 'separator') break;
          if (isSubmenu(item)) openSubmenu(activeIndex);
          else run(item);
          break;
        }
        case 'Escape':
          if (submenuIndex !== null) closeSubmenu();
          else onClose();
          break;
        default:
          // Anything else goes where it was going (a shortcut, typing),
          // without the menu
          if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) onClose();
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  });

  const renderCommand = (command: Command<C>, highlighted: boolean, onHover: () => void) => {
    const disabled = isDisabled(command);
    const checked = command.checked?.(context);
    return (
      <button
        key={command.id}
        className={cx('ui-menu__item', highlighted && 'is-highlighted', disabled && 'is-disabled')}
        onMouseEnter={onHover}
        onClick={() => run(command)}
        role={command.checked ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        type="button"
      >
        <span className="ui-menu__check">{checked && <Check size={12} />}</span>
        <span className="ui-menu__label">{command.label}</span>
        {command.shortcut && <span className="ui-menu__shortcut">{formatShortcut(command.shortcut)}</span>}
      </button>
    );
  };

  const renderSeparator = (index: number) => (
    <div key={`separator-${index}`} className="ui-menu__separator" role="separator" />
  );

  return (
    <div
      className="ui-menu wb-main-menu__panel"
      role="menu"
      aria-label="Menu"
      // A click on a row must not take the focus
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === 'separator') return renderSeparator(i);
        if (!isSubmenu(item)) return renderCommand(item, i === activeIndex, () => hoverRow(i));

        const expanded = i === submenuIndex;
        return (
          <div key={item.label} className="wb-main-menu__submenu" onMouseEnter={() => hoverRow(i)}>
            <button
              className={cx('ui-menu__item', i === activeIndex && 'is-highlighted')}
              onClick={() => openSubmenu(i)}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              type="button"
            >
              <span className="ui-menu__check" />
              <span className="ui-menu__label">{item.label}</span>
              <span className="ui-menu__arrow" aria-hidden="true"><ChevronRight size={12} /></span>
            </button>
            {expanded && (
              <div
                className="ui-menu wb-main-menu__panel wb-main-menu__panel--sub"
                role="menu"
                aria-label={item.label}
                onMouseLeave={() => setSubmenuActiveIndex(-1)}
              >
                {item.items.map((child, j) =>
                  child === 'separator'
                    ? renderSeparator(j)
                    : renderCommand(child, j === submenuActiveIndex, () => setSubmenuActiveIndex(j))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Reads the context while the popup is open: subscribing there re-renders only the open menu. */
function LivePopup<C>({ useCommandContext, ...props }: Omit<MenuPopupProps<C>, 'context'> & { useCommandContext: () => C }) {
  return <MenuPopup {...props} context={useCommandContext()} />;
}

// ============================================================
// Main Menu
// ============================================================

export interface MainMenuProps<C> {
  /** The app's commands, grouped. */
  items: MenuItem<C>[];
  /**
   * A hook that returns what `enabled` and `checked` look at, re-rendering
   * when it changes (the app's store hook). Called only while the menu is open.
   */
  useCommandContext: () => C;
  /** Runs before the menu opens (the editor passes on its pending typing, which decides what Save offers). */
  onOpen?: () => void;
  /** Class of the menu button (default: the top bar's tool button); `active` is added while open. */
  buttonClassName?: string;
  /** The shown surface: another surface's commands are disabled. */
  surface?: string;
}

/** The menu button: every command of the app, grouped, with its keyboard shortcut. */
export function MainMenu<C>({ items, useCommandContext, onOpen, buttonClassName = 'wb-tool', surface }: MainMenuProps<C>) {
  const [open, setOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback((byKeyboard: boolean) => {
    onOpen?.();
    setOpenedByKeyboard(byKeyboard);
    setOpen(true);
  }, [onOpen]);

  // Dismiss on outside click, blur or resize (keys are handled by the popup)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <div className="wb-main-menu" ref={rootRef}>
      <button
        className={cx(buttonClassName, open && 'active')}
        // Opening the menu with the mouse leaves the focus where it is
        onMouseDown={(e) => e.preventDefault()}
        // A click without a pointer is Enter or Space on the button
        onClick={(e) => (open ? close() : show(e.detail === 0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            show(true);
          }
        }}
        title="Menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
      >
        <MenuIcon size={16} />
      </button>

      {open && <LivePopup items={items} useCommandContext={useCommandContext} highlightFirst={openedByKeyboard} onClose={close} surface={surface} />}
    </div>
  );
}
