import { createAgents, type AgentHost } from '@lambda-house/agents';
import { getFileName } from '@lambda-house/reader';
import {
  appendToHistory, disableAgentWorkspace, enableAgentWorkspace, getAgentWorkspace, isTauri, markRead, onAgentFilesChanged, readSnapshot,
} from './utils/tauri';
import { documentWindowPath } from './utils/documentWindow';

// MDViewer's agent documents (@lambda-house/agents): the backend's agent
// workspace (src-tauri/src/agent.rs): the agents' own folders under ~/.claude,
// ~/.codex and ~/.gemini, and agent files in the folders opened in Files.
// The list is the global root in Files (components/AgentPanel.tsx); a
// project's agent files are in its folder's tree (Files → Agents).

// The Tauri functions are looked up when called, not when this module loads
// (tests replace that module with only what they use).
export const agentHost: AgentHost = {
  // A memory reader window shows its one document: no list, no scans
  get available() { return isTauri() && !documentWindowPath; },
  workspace: () => getAgentWorkspace(),
  onChange: (handler) => onAgentFilesChanged(handler),
  enable: () => enableAgentWorkspace(),
  disable: () => disableAgentWorkspace(),
  markRead: (paths) => markRead(paths),
  readSnapshot: (path) => readSnapshot(path),
  // A document opened for a look goes into the history (a double-click opens the same one again)
  opened: (path, preview) => {
    if (!preview) return;
    appendToHistory(path, getFileName(path)).catch((error) => console.error('Failed to log to history:', error));
  },
};

export const agents = createAgents(agentHost);
