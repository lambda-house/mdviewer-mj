import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCheck, ChevronRight, EyeOff, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { AgentList, disableAgents, markAgentsRead, refreshAgents, useAgents, type AgentEntry } from '@lambda-house/agents';
import { useStore } from '../store';
import { agents } from '../agents';
import { reader } from '../readerHost';

// ============================================================
// Global agent files: a root of Files, folded until opened. Its list is the
// agents package's (AgentList); here its header and its actions.
// ============================================================

/** The agents' own documents: a project's are in its folder's tree (Files → Agents). */
const isGlobal = (entry: AgentEntry) => entry.scope !== 'project';

const AgentPanel: React.FC = () => {
  const setAgentVisible = useStore((s) => s.setAgentVisible);
  const enabled = useAgents(agents, (s) => s.enabled);
  const anyChanged = useAgents(agents, (s) => s.entries.some((e) => isGlobal(e) && e.unread));
  const [rootCollapsed, setRootCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshAgents(agents, reader);
    } catch (error) {
      console.error('Failed to list agent files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!rootCollapsed) refresh();
  }, [rootCollapsed, refresh]);

  const handleMarkAllRead = useCallback(() => {
    const unread = agents.store.getState().entries.filter((e) => isGlobal(e) && e.unread).map((e) => e.path);
    markAgentsRead(agents, unread).catch((error) => {
      console.error('Failed to save read state:', error);
    });
  }, []);

  const handleDisable = useCallback(() => {
    disableAgents(agents).catch((error) => console.error('Failed to turn off the agent workspace:', error));
  }, []);

  return (
    <section className="directory-section global-agent-section" aria-label="Global agent files">
      <div className="directory-section-header">
        <button type="button" className="global-agent-root-toggle" aria-expanded={!rootCollapsed}
          onClick={() => setRootCollapsed((value) => !value)}>
          <span className={clsx('directory-section-expand', !rootCollapsed && 'expanded')}>
            <ChevronRight size={14} />
          </span>
          <Bot size={14} className="directory-section-icon" />
          <span className="global-agent-root-title">Global agent files</span>
          {anyChanged && <span className="agent-section-count">Changed</span>}
        </button>
        {!rootCollapsed && enabled && (
          <div className="agent-panel-actions">
            <button
              className="agent-panel-action"
              onClick={handleMarkAllRead}
              title="Mark everything as read"
              disabled={!anyChanged}
            >
              <CheckCheck size={14} />
            </button>
            <button
              className={clsx('agent-panel-action', loading && 'spinning')}
              onClick={refresh}
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw size={14} />
            </button>
            <button className="agent-panel-action" onClick={handleDisable} title="Turn off global agent access">
              <EyeOff size={14} />
            </button>
          </div>
        )}
        <button type="button" className="directory-section-action" onClick={() => setAgentVisible(false)}
          title="Hide global agent files (show again with the toolbar button)" aria-label="Hide global agent files">
          <X size={14} />
        </button>
      </div>

      {!rootCollapsed && (
        <AgentList
          agents={agents}
          only={isGlobal}
          noun="agent files"
          about="Covers Claude Code, Codex and Gemini CLI. Use Files → Agents for agent files in folders you open."
        />
      )}
    </section>
  );
};

export default AgentPanel;
