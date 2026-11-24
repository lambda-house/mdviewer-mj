// @lambda-house/workbench: the window shell's parts shared by MDViewer and
// Agent MCR. Styles are in ../workbench.css (import
// '@lambda-house/workbench/workbench.css' after the ui styles). Shared UI spec §5.
// Phase 3: commands, the main menu and the command palette. Phase 4: the layout tree, the shell, the plugin registry.
// Phase 8: the Workbench an app assembles from plugins (its points are the workbench:* ones).
// Phase 9: the window's commands (windowCommands) and the end of the top bar; the top bar as the title bar (titleBar);
// views and palette providers as plugin points, status items in order.

export {
  WindowMenuContext, ariaShortcut, commandForKey, commandTitle, createMenuStore, formatShortcut, forSurface, isSubmenu, matchesShortcut, menuCommands, menuEntries, onSurface,
  useCommandTitle, useMenu,
  type Command, type MenuItem, type MenuStore, type Shortcut, type Submenu,
} from './commands';
export { MainMenu, type MainMenuProps } from './MainMenu';
export {
  Palette, ProviderPalette, commandItems, commandProvider, matchesQuery,
  type PaletteItem, type PaletteProps, type PaletteProvider, type PaletteResults, type ProviderPaletteProps,
} from './Palette';
export {
  closeLeaf, COLLAPSE_FRACTION, findPaneOfType, placePane, findLeaf, findPane, findSplit, isPx, joinLeaves, leaves, minAlong, normalize, parentOf, resizeAt,
  setCollapsed, setPane, setSize, splitLeaf, swapPanes, toggleAt,
  type Layout, type LayoutNode, type Leaf, type Limits, type PaneRef, type Size, type Split,
} from './layout';
export { LayoutView, type LayoutViewProps, type PaneActions, type PaneContext, type PanePreview, type PaneType, type PaneZoom } from './LayoutView';
export { Pane, PaneMenu, PaneTitle, PaneZoomBadge, paneMenuItems, usePane, usePaneZoom } from './panes';
export { Shell, ShellStatus, ShellTools, ShellViews, useSurfaceShown, type ShellProps, type ShellSurface, type ShellView, type ShellViewsProps } from './Shell';
export { Workbench, usePaneTypes, useViews, type WorkbenchProps } from './Workbench';
export { NO_DRAG, TRAFFIC_LIGHT_INSET, TRAFFIC_LIGHT_X, TRAFFIC_LIGHTS_WIDTH, topRowInset, topRowProps, type TitleBar, type TopRowProps } from './titleBar';
export { StatusItem } from './StatusBar';
export {
  PluginRegistry, createPlugin, usePlugins,
  type Plugin, type PluginApi, type PluginStorage, type WorkbenchEvents, type WorkbenchPoints, type WorkbenchSlots,
  type WorkbenchOverlay, type WorkbenchPaneType, type WorkbenchSurface, type WorkbenchView, type WorkbenchWrapper,
} from './plugins';
export { PANE_ZOOM, layoutCommands, stepPaneZoom, zoomCommands, type ZoomFallback } from './paneCommands';
export {
  PALETTE_SHORTCUT, SETTINGS_SHORTCUT, WINDOW_COMMANDS, windowCommands, type Theme, type WindowCommandOptions, type WindowCommands,
} from './windowCommands';
export {
  canResetLayout, focusNextPane, focusedPane, focusedPaneVersion, focusedZoom, resetLayout, setFocusedPane, subscribeFocusedPane,
} from './focus';
export { SettingsDialog, SettingsSection, SettingsToggle, appearanceTab, pluginsTab, shortcutsTab, type SettingsDialogProps, type SettingsTab } from './settings';
