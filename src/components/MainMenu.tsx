import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Check, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { formatShortcut, isSubmenu, type Command, type MenuItem } from '../utils/commands';
import { flushEditorChanges } from '../utils/editorRegistry';

/**
 * How long an open submenu stays when the pointer moves to another row (ms):
 * on its way to the submenu the pointer usually crosses the rows below.
 */
const SUBMENU_SWITCH_DELAY = 250;

// ============================================================
// Menu Popup
// ============================================================

interface MenuPopupProps {
  items: MenuItem[];
  /** Opened from the keyboard: the first row starts highlighted. */
  highlightFirst: boolean;
  onClose: () => void;
}

/**
 * The open menu. The keyboard focus stays where it was (the editor, an
 * input), so it is still there once the menu closes; keys are caught on the
 * window instead.
 */
const MenuPopup: React.FC<MenuPopupProps> = ({ items, highlightFirst, onClose }) => {
  // The whole state: what is enabled or checked follows it while the menu is open
  const state = useStore();
  /** Highlighted row (-1: none). */
  const [activeIndex, setActiveIndex] = useState(highlightFirst ? 0 : -1);
  /** Row whose submenu is open. */
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  /** Highlighted row of the open submenu (-1: none, the keys move in the menu itself). */
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(-1);
  const switchTimer = useRef<ReturnType<typeof setTimeout>>();

  const isDisabled = (command: Command) => command.enabled?.(state) === false;
  const canHighlight = (item: MenuItem) =>
    item !== 'separator' && (isSubmenu(item) || !isDisabled(item));

  /** The next row to highlight, down (1) or up (-1) from `from`, wrapping around. */
  const step = (list: MenuItem[], from: number, direction: 1 | -1): number => {
    const start = from === -1 && direction === -1 ? 0 : from;
    for (let n = 1; n <= list.length; n++) {
      const index = (((start + direction * n) % list.length) + list.length) % list.length;
      if (canHighlight(list[index])) return index;
    }
    return from;
  };

  const run = (command: Command) => {
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

  const renderCommand = (command: Command, highlighted: boolean, onHover: () => void) => {
    const disabled = isDisabled(command);
    const checked = command.checked?.(state);
    return (
      <button
        key={command.id}
        className={clsx('main-menu-item', highlighted && !disabled && 'highlighted', disabled && 'disabled')}
        onMouseEnter={onHover}
        onClick={() => run(command)}
        role={command.checked ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        type="button"
      >
        <span className="main-menu-check">{checked && <Check size={12} />}</span>
        <span className="main-menu-label">{command.label}</span>
        {command.shortcut && (
          <span className="main-menu-shortcut">{formatShortcut(command.shortcut)}</span>
        )}
      </button>
    );
  };

  const renderSeparator = (index: number) => (
    <div key={`separator-${index}`} className="context-menu-separator" role="separator" />
  );

  return (
    <div
      className="context-menu main-menu-panel"
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
          <div key={item.label} className="main-menu-submenu" onMouseEnter={() => hoverRow(i)}>
            <button
              className={clsx('main-menu-item', i === activeIndex && 'highlighted')}
              onClick={() => openSubmenu(i)}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              type="button"
            >
              <span className="main-menu-check" />
              <span className="main-menu-label">{item.label}</span>
              <ChevronRight size={12} className="main-menu-arrow" aria-hidden="true" />
            </button>
            {expanded && (
              <div
                className="context-menu main-menu-panel main-menu-subpanel"
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
};

// ============================================================
// Main Menu Component
// ============================================================

interface MainMenuProps {
  /** The app's commands, as laid out by `buildMenu`. */
  items: MenuItem[];
}

/**
 * The toolbar's menu button: every command of the app, grouped, with its
 * keyboard shortcut.
 */
const MainMenu: React.FC<MainMenuProps> = ({ items }) => {
  const [open, setOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback((byKeyboard: boolean) => {
    // Typing the editor has not passed on yet decides what Save offers
    flushEditorChanges();
    setOpenedByKeyboard(byKeyboard);
    setOpen(true);
  }, []);

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
    <div className="main-menu" ref={rootRef}>
      <button
        className={clsx('toolbar-button', open && 'active')}
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
        <Menu size={16} />
      </button>

      {open && <MenuPopup items={items} highlightFirst={openedByKeyboard} onClose={close} />}
    </div>
  );
};

export default MainMenu;
