import { useSyncExternalStore } from 'react';
import { PLATFORM, type Platform } from '@lambda-house/ui';

// The commands of an app in one list: the main menu shows them, the key
// handler runs them by their shortcuts, the native menu's events and the
// command palette find them by id and label. `C` is what `enabled` and
// `checked` look at: the app's state.

// ============================================================
// Shortcuts
// ============================================================

export interface Shortcut {
  /** `KeyboardEvent.key`; letters in lower case. */
  key: string;
  /** Ctrl, or Cmd on macOS. */
  mod?: boolean;
  /** Ctrl, on macOS too: the system keeps Cmd+Tab for itself. */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * The key a press stands for. On a layout without Latin letters (Cyrillic,
 * Greek) that is the letter on the physical key, so Ctrl+S saves there too.
 */
function pressedKey(e: KeyboardEvent): string {
  if (e.key.length === 1 && e.key.charCodeAt(0) > 127) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) return letter[1].toLowerCase();
  }
  return e.key.toLowerCase();
}

/** Whether a key press is this shortcut. Ctrl and Cmd both count as the modifier. */
export function matchesShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
  if (pressedKey(e) !== shortcut.key.toLowerCase()) return false;
  if ((e.metaKey || e.ctrlKey) !== Boolean(shortcut.mod || shortcut.ctrl)) return false;
  if (e.altKey !== Boolean(shortcut.alt)) return false;
  // Shift is part of typing a symbol or a digit ("+" is Shift+= on a US
  // keyboard, digits need Shift on AZERTY): it only tells letters and named
  // keys apart
  const shiftCounts = shortcut.key.length > 1 || /[a-z]/i.test(shortcut.key);
  return !shiftCounts || e.shiftKey === Boolean(shortcut.shift);
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right' };
const MAC_KEY_NAMES: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→' };

/** A shortcut as the platform writes it: "Ctrl+Shift+S", or "⇧⌘S" on macOS. */
export function formatShortcut(shortcut: Shortcut, platform: Platform = PLATFORM): string {
  const isMac = platform === 'macos';
  const key = (isMac ? MAC_KEY_NAMES : KEY_NAMES)[shortcut.key]
    ?? (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);

  const parts = isMac
    // The order of macOS menus: Control, Option, Shift, Command
    ? [shortcut.ctrl && '⌃', shortcut.alt && '⌥', shortcut.shift && '⇧', shortcut.mod && '⌘', key]
    : [(shortcut.mod || shortcut.ctrl) && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key];
  return parts.filter(Boolean).join(isMac ? '' : '+');
}

/** A shortcut for `aria-keyshortcuts`: "Meta+Shift+P", "Control+Shift+P". */
export function ariaShortcut(shortcut: Shortcut, platform: Platform = PLATFORM): string {
  const isMac = platform === 'macos';
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return [
    (shortcut.ctrl || (shortcut.mod && !isMac)) && 'Control',
    shortcut.mod && isMac && 'Meta',
    shortcut.alt && 'Alt',
    shortcut.shift && 'Shift',
    key,
  ].filter(Boolean).join('+');
}

// ============================================================
// Commands and the menu
// ============================================================

export interface Command<C = unknown> {
  id: string;
  label: string;
  shortcut?: Shortcut;
  /** Other keys that run the command; the menu shows only `shortcut`. */
  aliases?: Shortcut[];
  /**
   * Whether the menu offers the command now (default: always). `run` is safe
   * to call either way: a shortcut runs it without asking.
   */
  enabled?: (context: C) => boolean;
  /** A toggle: whether it is on now (the menu shows a check mark). */
  checked?: (context: C) => boolean;
  run: () => void;
  /** Listed in the command palette (default: yes). */
  palette?: boolean;
  /**
   * The surface it belongs to (shared UI spec §5.5): its shortcut works and
   * the palette lists it only while that surface is shown; the menu shows
   * it disabled elsewhere. Without it, everywhere.
   */
  surface?: string;
}

/** Whether a command can be used on the shown surface. */
export function onSurface<C>(command: Command<C>, surface?: string): boolean {
  return !command.surface || !surface || command.surface === surface;
}

/** The same commands, belonging to one surface. */
export function forSurface<C>(surface: string, commands: Array<Command<C> | 'separator'>): Array<Command<C> | 'separator'> {
  return commands.map((command) => (command === 'separator' ? command : { ...command, surface }));
}

export interface Submenu<C = unknown> {
  label: string;
  items: Array<Command<C> | 'separator'>;
}

export type MenuItem<C = unknown> = Command<C> | Submenu<C> | 'separator';

export function isSubmenu<C>(item: MenuItem<C>): item is Submenu<C> {
  return item !== 'separator' && 'items' in item;
}

/** Every command of a menu, the ones in submenus included. */
export function menuCommands<C>(items: MenuItem<C>[]): Command<C>[] {
  return items.flatMap((item) => {
    if (item === 'separator') return [];
    return isSubmenu(item) ? menuCommands(item.items) : [item];
  });
}

/** Every command with the label of the submenu it is in ('' at the top level). */
export function menuEntries<C>(items: MenuItem<C>[], within = ''): Array<{ command: Command<C>; submenu: string }> {
  return items.flatMap((item) => {
    if (item === 'separator') return [];
    return isSubmenu(item) ? menuEntries(item.items, item.label) : [{ command: item, submenu: within }];
  });
}

/** The command a key press runs, if any: the first on the shown surface whose shortcut or alias matches. */
export function commandForKey<C>(commands: Command<C>[], e: KeyboardEvent, surface?: string): Command<C> | undefined {
  // The webview's autofill sends keydown events without a key
  if (!e.key) return undefined;

  return commands.find((command) =>
    onSurface(command, surface)
    && [command.shortcut, ...(command.aliases ?? [])].some((shortcut) => shortcut && matchesShortcut(e, shortcut))
  );
}

// ============================================================
// The current menu, for whoever needs it (the palette)
// ============================================================

export interface MenuStore<C> {
  set: (menu: MenuItem<C>[]) => void;
  get: () => MenuItem<C>[];
  subscribe: (listener: () => void) => () => void;
}

/** Holds an app's menu, set where it is built (App), read where it is shown. */
export function createMenuStore<C>(): MenuStore<C> {
  let menu: MenuItem<C>[] = [];
  const listeners = new Set<() => void>();
  return {
    set: (next) => {
      if (next === menu) return;
      menu = next;
      listeners.forEach((listener) => listener());
    },
    get: () => menu,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The menu a store holds, re-rendering when it changes. */
export function useMenu<C>(store: MenuStore<C>): MenuItem<C>[] {
  return useSyncExternalStore(store.subscribe, store.get);
}
