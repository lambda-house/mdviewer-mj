import type { ReactNode } from 'react';
import { Database, Shield } from 'lucide-react';
import { Button, SettingRow } from '@lambda-house/ui';
import { SettingsSection, type SettingsTab } from '@lambda-house/workbench';
import { AgentAccess } from './AgentAccess';
import { errorText, JournalProvider, useJournal, useJournalContext, type Journal } from './host';
import { MemoryBrowser } from './MemoryBrowser';

// The journal's tabs in the Settings dialog (shared UI spec §5.6): session
// access (and agent access to the index), and the agents' memories.

function SessionAccess() {
  const { store, host } = useJournalContext();
  const enabled = useJournal((s) => s.enabled);
  const error = useJournal((s) => s.error);
  const enable = async () => { try { store.getState().setEnabled(await host.enable()); } catch (e) { store.getState().setError(errorText(e)); } };
  const revoke = async () => { try { await host.disable(); store.getState().forget(); } catch (e) { store.getState().setError(errorText(e)); } };
  return (
    <>
      <SettingsSection title="Session access" description={`${host.appName} reads the transcripts of Codex and Claude sessions on this machine only while access is on; revoking it forgets the index.`}>
        <div className="settings-card">
          <SettingRow
            label={enabled ? 'Access is on' : 'Access is off'}
            description={error || (enabled ? 'The journal indexes local transcripts. It never changes them.' : host.available ? 'Nothing is read until you turn it on.' : 'Open the desktop app to connect local sessions.')}
            control={enabled
              ? <Button variant="secondary" size="sm" onClick={() => void revoke()}>Revoke session access</Button>
              : <Button variant="primary" size="sm" disabled={!host.available} onClick={() => void enable()}>Enable session access</Button>}
          />
        </div>
      </SettingsSection>
      {host.analysis && (
        <SettingsSection title="Agent access">
          <div className="settings-embedded-host">
            <AgentAccess embedded directory="" inspect={(key, event) => store.getState().inspect(key, event)} />
          </div>
        </SettingsSection>
      )}
    </>
  );
}

/** The journal's Settings tabs; `memories` goes above the memory browser (Agent MCR's TEOB connection). */
export function journalSettingsTabs(journal: Journal, { memories }: { memories?: ReactNode } = {}): SettingsTab[] {
  return [
    {
      id: 'session-access', label: 'Session access', icon: <Shield size={15} />, group: 'Journal', order: 60,
      render: () => <JournalProvider journal={journal}><SessionAccess /></JournalProvider>,
    },
    {
      id: 'memories', label: 'Memories', icon: <Database size={15} />, group: 'Journal', order: 61,
      render: () => (
        <JournalProvider journal={journal}>
          {memories}
          <SettingsSection title="User memories" description="Agent memories and instructions across recorded workspaces.">
            <div className="session-cockpit settings-embedded-host"><MemoryBrowser /></div>
          </SettingsSection>
        </JournalProvider>
      ),
    },
  ];
}
