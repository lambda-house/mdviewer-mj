// @lambda-house/workbench: the window shell's parts shared by MDViewer and
// Agent MCR. Styles are in ../workbench.css (import
// '@lambda-house/workbench/workbench.css' after the ui styles). Shared UI spec §5.
// Phase 3: commands, the main menu and the command palette. Phase 4: the layout tree, the shell, the plugin registry.

export {
  ariaShortcut, commandForKey, createMenuStore, formatShortcut, forSurface, isSubmenu, matchesShortcut, menuCommands, menuEntries, onSurface, useMenu,
  type Command, type MenuItem, type MenuStore, type Shortcut, type Submenu,
} from './commands';
export { MainMenu, type MainMenuProps } from './MainMenu';
export { Palette, commandItems, matchesQuery, type PaletteItem, type PaletteProps } from './Palette';
export {
  closeLeaf, COLLAPSE_FRACTION, findPaneOfType, placePane, findLeaf, findPane, findSplit, isPx, joinLeaves, leaves, minAlong, normalize, parentOf, resizeAt,
  setCollapsed, setPane, setSize, splitLeaf, swapPanes, toggleAt,
  type Layout, type LayoutNode, type Leaf, type Limits, type PaneRef, type Size, type Split,
} from './layout';
export { LayoutView, type LayoutViewProps, type PaneActions, type PaneContext, type PanePreview, type PaneType, type PaneZoom } from './LayoutView';
export { Pane, PaneMenu, PaneTitle, PaneZoomBadge, paneMenuItems, usePane, usePaneZoom } from './panes';
export { Shell, ShellStatus, ShellTools, ShellViews, type ShellProps, type ShellSurface, type ShellView, type ShellViewsProps } from './Shell';
export { StatusItem } from './StatusBar';
export {
  PluginRegistry, createPlugin, usePlugins,
  type Plugin, type PluginApi, type PluginStorage, type WorkbenchEvents, type WorkbenchPoints, type WorkbenchSlots,
} from './plugins';
export { layoutCommands, zoomCommands, type ZoomFallback } from './paneCommands';
export {
  canResetLayout, focusNextPane, focusedPane, focusedPaneVersion, focusedZoom, resetLayout, setFocusedPane, subscribeFocusedPane,
} from './focus';
