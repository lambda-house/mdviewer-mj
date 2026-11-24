import { useEffect, useRef } from 'react';
import type { Plugin } from '@lambda-house/workbench';
import { allTabs, useReader, useReaderContext } from '@lambda-house/reader';
import { refreshAgents, useAgents, type Agents } from './agents';

/** An agent writes several files in a row: scan once they pause (ms). */
export const AGENT_CHANGE_DEBOUNCE = 500;
/** How often they are scanned while the backend cannot watch them (ms). */
export const AGENT_POLL_INTERVAL = 10_000;

export interface AgentsPluginOptions {
  /**
   * A hook: whether the agents' documents are watched now, that is scanned
   * when the backend reports a change (polled when it cannot watch) and when
   * the window gets the focus. `open`: one of them is open in a tab. MDViewer
   * watches while its global root is on or one is open; Agent MCR while
   * Documents is shown with their pane or one of them open.
   */
  useWatched(open: boolean): boolean;
  /**
   * A hook: what asks for a scan when it changes, watched or not (MDViewer's
   * opened folders, whose agent files the backend then lists and watches).
   * Unwatched, they are scanned once per key, so the reader still knows
   * which open documents are an agent's ("what changed since you read it").
   */
  useScanKey?(): string;
}

/** Scans the agents' documents while they are watched; renders nothing. */
function AgentWatch({ agents, useWatched, useScanKey }: AgentsPluginOptions & { agents: Agents }) {
  const reader = useReaderContext();
  const entries = useAgents(agents, (s) => s.entries);
  const open = useReader((s) => allTabs(s).some((t) => entries.some((e) => e.path === t.path)));
  const watched = useWatched(open);
  const key = useScanKey?.() ?? '';
  // The key of the last scan: unwatched, a key is scanned once
  const scannedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!agents.host.available) return;
    if (!watched) {
      if (scannedFor.current !== key) {
        scannedFor.current = key;
        refreshAgents(agents, reader).catch(() => {});
      }
      return;
    }
    scannedFor.current = key;
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        refreshAgents(agents, reader).catch((error) => console.error('Failed to refresh agent files:', error));
      }
    };
    refresh();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, AGENT_CHANGE_DEBOUNCE);
    };
    const unlisten = agents.host.onChange(scheduleRefresh);
    // The backend couldn't watch them: poll instead
    const poll = setInterval(() => {
      if (!agents.store.getState().watching) refresh();
    }, AGENT_POLL_INTERVAL);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      unlisten.then((stop) => stop()).catch(() => {});
      window.removeEventListener('focus', refresh);
    };
  }, [agents, reader, watched, key]);

  return null;
}

/**
 * The agent documents as a plugin (shared UI spec §6.3): it keeps them
 * scanned while the app watches them. Where the list goes is the app's:
 * MDViewer draws `AgentList` in its Files panel, Agent MCR `AgentPane` as a
 * pane of its Documents view. Required: always on, not in the Plugins tab.
 */
export function agentsPlugin(agents: Agents, options: AgentsPluginOptions): Plugin {
  return {
    id: 'agents',
    name: 'Agent documents',
    description: 'What coding agents read and write: instructions, rules, memory, plans, skills.',
    required: true,
    setup(api) {
      api.contribute('workbench:overlay', { id: 'agents:watch', render: () => <AgentWatch agents={agents} {...options} /> });
    },
  };
}
