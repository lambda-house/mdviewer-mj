import { PluginRegistry } from '@lambda-house/workbench';

// The window's plugins (shared UI spec §5.7): App registers the reader, the
// journal and MDViewer's own part, and draws the Workbench of them. Kept in
// a module of its own so a surface can read its view's pane types from it
// (usePaneTypes) without importing App.

export const registry = new PluginRegistry(null, 'mdviewer');
