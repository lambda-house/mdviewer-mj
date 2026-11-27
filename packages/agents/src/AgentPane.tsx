import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCheck, EyeOff, RefreshCw } from 'lucide-react';
import { Button, useSmoothWheelScroll } from '@lambda-house/ui';
import { Pane, usePaneZoom } from '@lambda-house/workbench';
import { useReader, useReaderContext } from '@lambda-house/reader';
import { disableAgents, markAgentsRead, refreshAgents, useAgents, type Agents } from './agents';
import { AgentList } from './AgentList';

export interface AgentPaneProps {
  agents: Agents;
  /** What reading them covers, in the introduction before it is on. */
  about: ReactNode;
  /** A session folder's name as shown. */
  folderLabel: (path: string) => ReactNode;
}

/**
 * The agent documents as a pane of their own (Agent MCR's `agent-docs`):
 * the list by session folder, with mark-all-read, refresh and turn-off in
 * the header. Scanned when it opens; its tree scrolls and zooms (the pane
 * type's zoom).
 */
export function AgentPane({ agents, about, folderLabel }: AgentPaneProps) {
  const reader = useReaderContext();
  const enabled = useAgents(agents, (s) => s.enabled);
  const anyUnread = useAgents(agents, (s) => s.entries.some((e) => e.unread));
  const zoom = usePaneZoom();
  const smoothScroll = useReader((s) => s.settings.smoothScroll);
  const [loading, setLoading] = useState(false);
  const treeRef = useRef<HTMLElement>(null);
  useSmoothWheelScroll(treeRef, smoothScroll, enabled === true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshAgents(agents, reader);
    } catch (error) {
      console.error('Failed to list agent files:', error);
    } finally {
      setLoading(false);
    }
  }, [agents, reader]);

  useEffect(() => { void refresh(); }, [refresh]);

  const markAllRead = () => {
    markAgentsRead(agents, agents.store.getState().entries.filter((e) => e.unread).map((e) => e.path)).catch((error) => {
      console.error('Failed to save read state:', error);
    });
  };

  return (
    <Pane
      as="aside"
      className="agents-pane"
      title="Agent documents"
      tools={<>
        {enabled && <>
          <Button variant="ghost" size="xs" icon={<CheckCheck size={16} />} onClick={markAllRead} title="Mark everything as read" aria-label="Mark everything as read" disabled={!anyUnread} />
          <Button variant="ghost" size="xs" icon={<RefreshCw size={16} />} onClick={refresh} title="Refresh" aria-label="Refresh" disabled={loading} busy={loading} />
          <Button variant="ghost" size="xs" icon={<EyeOff size={16} />} onClick={() => disableAgents(agents).catch((error) => console.error('Failed to turn off the agent workspace:', error))} title="Stop reading agent documents" aria-label="Stop reading agent documents" />
        </>}
      </>}
    >
      <AgentList
        agents={agents}
        about={about}
        folders={{ label: folderLabel }}
        frame={(sections) => (
          <nav ref={treeRef} className="agents-tree" role="tree" aria-label="Agent documents">
            <div className="agent-panel-content" style={{ zoom: zoom / 100 }}>{sections}</div>
          </nav>
        )}
      />
    </Pane>
  );
}
