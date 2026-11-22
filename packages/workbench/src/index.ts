// @lambda-house/workbench: the window shell's parts shared by MDViewer and
// Agent MCR. Styles are in ../workbench.css (import
// '@lambda-house/workbench/workbench.css' after the ui styles). Shared UI spec §5.
// Phase 3: commands, the main menu and the command palette.

export {
  ariaShortcut, commandForKey, createMenuStore, formatShortcut, isSubmenu, matchesShortcut, menuCommands, menuEntries, useMenu,
  type Command, type MenuItem, type MenuStore, type Shortcut, type Submenu,
} from './commands';
export { MainMenu, type MainMenuProps } from './MainMenu';
export { Palette, commandItems, matchesQuery, type PaletteItem, type PaletteProps } from './Palette';
