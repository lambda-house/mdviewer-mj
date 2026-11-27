// @lambda-house/agents: the documents coding agents read and write
// (instructions, rules, memory, plans, skills, agents, commands), shared by
// MDViewer and Agent MCR (shared UI spec §6.3). Styles are in ../agents.css
// (import '@lambda-house/agents/agents.css' after the reader's styles).
// Phase 9 part 4: the entries and their helpers, the store and its host,
// the list and its pane, the plugin that keeps them scanned. It builds on the
// reader: an agent document opens in it, and its reads feed "what changed".

export {
  AGENT_SECTIONS, agentEntryMatches, agentFolders,
  type AgentEntry, type AgentFolder, type AgentKind, type AgentWorkspace, type ReadSnapshot,
} from './entries';
export {
  agentChanges, createAgents, disableAgents, enableAgents, markAgentsRead, refreshAgents, useAgents,
  type AgentHost, type Agents, type AgentsState, type AgentsStore,
} from './agents';
export { AgentList, type AgentListProps } from './AgentList';
export { AgentPane, type AgentPaneProps } from './AgentPane';
export { AGENT_CHANGE_DEBOUNCE, AGENT_POLL_INTERVAL, agentsPlugin, type AgentsPluginOptions } from './plugin';
