import type { ReactNode } from 'react';
import type { Plugin } from '@lambda-house/workbench';
import { JournalProvider, type Journal } from './host';
import { JournalView, type JournalViewProps } from './JournalView';
import { journalSettingsTabs } from './JournalSettings';

// The journal as a workbench plugin (shared UI spec §5.7): its provider, its
// Settings tabs and, when the app gives it one, its own surface of the window
// (MDViewer's Journal). An app that shows it elsewhere (Agent MCR: a view of
// Sessions) draws JournalView there itself.

export interface JournalPluginOptions {
  /** Its own surface of the window; without it, the app shows JournalView where it likes. */
  surface?: { id: string; label: string; icon?: ReactNode; order?: number; tools?: JournalViewProps['tools'] };
  /** Above the memory browser in the Memories tab (Agent MCR's TEOB connection). */
  memories?: ReactNode;
}

/** The journal's part of the window. Always on. */
export function journalPlugin(journal: Journal, options: JournalPluginOptions = {}): Plugin {
  return {
    id: 'journal',
    name: 'Journal',
    description: 'Past agent sessions: search, details side by side, usage, memories.',
    required: true,
    setup(api) {
      api.contribute('workbench:wrapper', { id: 'journal', order: 20, wrap: (children) => <JournalProvider journal={journal}>{children}</JournalProvider> });
      for (const tab of journalSettingsTabs(journal, { memories: options.memories })) api.contribute('workbench:settings-tab', tab);
      const surface = options.surface;
      if (surface) {
        api.contribute('workbench:surface', {
          id: surface.id, label: surface.label, icon: surface.icon, order: surface.order,
          // Its view asks for the index only while this surface is shown
          render: () => <JournalView tools={surface.tools} />,
        });
      }
    },
  };
}
