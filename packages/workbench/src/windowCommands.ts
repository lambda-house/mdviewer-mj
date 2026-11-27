import type { Command, Shortcut } from './commands';

// The window's own commands, the same in every app: the palette, Settings,
// the theme, pinning the status bar. The app puts them where its menu has
// them; the top bar's buttons at the end find them there by their ids, for
// their tooltips.

export type Theme = 'dark' | 'light';

/** The window commands' ids: the native menus send these, the top bar looks them up. */
export const WINDOW_COMMANDS = {
  palette: 'app.commandPalette',
  settings: 'app.settings',
  pinStatusBar: 'view.pinStatusBar',
  darkTheme: 'view.darkTheme',
  lightTheme: 'view.lightTheme',
} as const;

/** The palette's key on every platform: Ctrl+Shift+P, ⇧⌘P (shared UI spec §5.5). */
export const PALETTE_SHORTCUT: Readonly<Shortcut> = { mod: true, shift: true, key: 'p' };
export const SETTINGS_SHORTCUT: Readonly<Shortcut> = { mod: true, key: ',' };

export interface WindowCommandOptions {
  /** Opens the palette. `enabled`: whether it can now (default: always); `label`: its name in the menu. */
  palette: { open: () => void; enabled?: () => boolean; label?: string };
  settings: { open: () => void };
  theme: { get: () => Theme; set: (theme: Theme) => void };
  statusBar: { pinned: () => boolean; setPinned: (pinned: boolean) => void };
}

export interface WindowCommands {
  palette: Command;
  settings: Command;
  pinStatusBar: Command;
  darkTheme: Command;
  lightTheme: Command;
}

/** The window's commands; their state is read when the menu asks. */
export function windowCommands({ palette, settings, theme, statusBar }: WindowCommandOptions): WindowCommands {
  const canOpen = palette.enabled;
  return {
    palette: {
      id: WINDOW_COMMANDS.palette,
      label: palette.label ?? 'Command Palette…',
      shortcut: { ...PALETTE_SHORTCUT },
      // The palette lists the commands, not itself
      palette: false,
      ...(canOpen && { enabled: () => canOpen() }),
      run: () => { if (!canOpen || canOpen()) palette.open(); },
    },
    settings: { id: WINDOW_COMMANDS.settings, label: 'Settings…', shortcut: { ...SETTINGS_SHORTCUT }, run: () => settings.open() },
    pinStatusBar: {
      id: WINDOW_COMMANDS.pinStatusBar,
      label: 'Pin Status Bar',
      checked: () => statusBar.pinned(),
      run: () => statusBar.setPinned(!statusBar.pinned()),
    },
    darkTheme: { id: WINDOW_COMMANDS.darkTheme, label: 'Dark Theme', checked: () => theme.get() === 'dark', run: () => theme.set('dark') },
    lightTheme: { id: WINDOW_COMMANDS.lightTheme, label: 'Light Theme', checked: () => theme.get() === 'light', run: () => theme.set('light') },
  };
}
