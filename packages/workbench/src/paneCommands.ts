import type { Command } from './commands';
import { canResetLayout, focusNextPane, focusedPane, resetLayout } from './focus';

// The workbench's commands (shared UI spec §5.5): they act on the focused
// pane, whatever its type, through what its layout and its pane type offer.

/** Split, close and move between panes; put a layout back. */
export function layoutCommands(): Command[] {
  const pane = () => focusedPane();
  return [
    {
      // No shortcut: an app's own split (the document's, on Mod+\) keeps the key
      id: 'layout.splitRight', label: 'Split Pane Right',
      enabled: () => !!pane()?.actions.canSplit,
      run: () => pane()?.actions.split('row'),
    },
    {
      id: 'layout.splitDown', label: 'Split Pane Down',
      enabled: () => !!pane()?.actions.canSplit,
      run: () => pane()?.actions.split('col'),
    },
    {
      id: 'layout.closePane', label: 'Close Pane',
      enabled: () => !!pane()?.actions.canClose,
      run: () => pane()?.actions.close(),
    },
    { id: 'layout.focusNext', label: 'Focus Next Pane', shortcut: { key: 'F6' }, run: () => { focusNextPane(1); } },
    { id: 'layout.focusPrevious', label: 'Focus Previous Pane', shortcut: { shift: true, key: 'F6' }, run: () => { focusNextPane(-1); } },
    { id: 'layout.reset', label: 'Reset Layout', enabled: canResetLayout, run: () => { resetLayout(); } },
  ];
}

/** What the zoom commands use while no pane has the focus yet. */
export interface ZoomFallback {
  get: () => number;
  step: (direction: 1 | -1 | 0) => void;
}

/** Zoom in, out and back: the focused pane, through its pane type's zoom. */
export function zoomCommands(fallback?: ZoomFallback): Command[] {
  // A focused pane that doesn't zoom turns them off; with no pane focused yet, the fallback zooms
  const zoom = () => {
    const pane = focusedPane();
    return pane ? pane.actions.zoom : fallback ?? null;
  };
  return [
    {
      id: 'view.zoomIn', label: 'Zoom In', shortcut: { mod: true, key: '+' }, aliases: [{ mod: true, key: '=' }],
      enabled: () => !!zoom(), run: () => zoom()?.step(1),
    },
    { id: 'view.zoomOut', label: 'Zoom Out', shortcut: { mod: true, key: '-' }, enabled: () => !!zoom(), run: () => zoom()?.step(-1) },
    {
      id: 'view.resetZoom', label: 'Reset Zoom', shortcut: { mod: true, key: '0' },
      enabled: () => { const z = zoom(); return !!z && z.get() !== 100; },
      run: () => zoom()?.step(0),
    },
  ];
}
