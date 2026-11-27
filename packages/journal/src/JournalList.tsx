import { useMemo, useState, type MouseEvent } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { Menu } from '@lambda-house/ui';
import { Pane } from '@lambda-house/workbench';
import { useJournal, useJournalContext } from './host';
import { DirectoryMap, FolderResults } from './FolderResults';
import { filterSessions, filtersOn as countFilters, homePath, NO_FILTERS, type SessionFilters } from './sessions';

const isMod = (event: MouseEvent) => event.metaKey || event.ctrlKey;

/** One `journal-list` pane: its header (the pane menu), the search, the filters and the sessions. */
export function JournalList({ pane }: { pane: string }) {
  const { store } = useJournalContext();
  const filters = useJournal((s) => s.lists[pane]) ?? NO_FILTERS;
  const snapshot = useJournal((s) => s.snapshot);
  const busy = useJournal((s) => s.busy);
  const selected = useJournal((s) => s.details[s.lastDetail]?.session ?? '');
  const [menu, setMenu] = useState<{ key: string; top: number; left: number } | null>(null);

  const matches = useMemo(() => filterSessions(snapshot.sessions, filters), [snapshot.sessions, filters]);
  const set = (update: Partial<SessionFilters>) => store.getState().setFilters(pane, update);
  const on = countFilters(filters);
  const field = <K extends keyof SessionFilters>(key: K) => ({ value: filters[key], onChange: (e: { target: { value: string } }) => set({ [key]: e.target.value }) });

  const open = (key: string, event: MouseEvent) => { store.getState().show(key, { side: isMod(event) }); };
  const openMenu = (key: string, event: MouseEvent) => {
    event.preventDefault();
    setMenu({ key, top: event.clientY, left: event.clientX });
  };

  return (
    <Pane as="aside" className="sc-session-list ss-list" aria-label="Session search" title="Sessions">
      <div className="sc-search ss-search"><Search size={14} /><input aria-label="Search sessions" placeholder="Find a task, ticket, model or tool…" {...field('query')} /></div>
      <details className="ss-filters">
        <summary><span>Filters{on ? ` · ${on} on` : ''}</span><span className="ss-count">{matches.length.toLocaleString()} sessions</span><ChevronRight size={12} /></summary>
        <div className="ss-filter-fields">
          <select aria-label="Provider" {...field('provider')}><option value="all">All providers</option><option value="codex">Codex</option><option value="claude">Claude</option></select>
          <select aria-label="Session origin" {...field('role')}><option value="all">Humans & agents</option><option value="human">Human sessions</option><option value="subagent">Subagents</option><option value="automation">Automation / exec</option><option value="unknown">Unknown origin</option></select>
          <select aria-label="Activity filter" {...field('activity')}><option value="all">All activity</option><option value="working">Observed working</option><option value="recent">Last 24 hours</option><option value="roots">Root sessions</option><option value="stale">Stale / unconfirmed</option><option value="idle">Idle</option><option value="interrupted">Interrupted</option></select>
          <label>Active in the last<select aria-label="Active in the last" {...field('activeMinutes')}><option value="">Any time</option><option value="5">5 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">7 days</option></select></label>
          <label>No activity for<select aria-label="No activity for" {...field('inactiveMinutes')}><option value="">Any duration</option><option value="5">5 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">7 days</option></select></label>
          <label>Active since<input aria-label="Active since" type="datetime-local" {...field('activeSince')} /></label>
          <label>Inactive since<input aria-label="Inactive since" type="datetime-local" {...field('inactiveSince')} /></label>
          <p className="sc-time-help">Filters combine using last recorded activity. Dates use local time.</p>
          <DirectoryMap sessions={snapshot.sessions} directory={filters.directory} current={snapshot.currentDirectory || ''} select={(directory) => set({ directory })} />
        </div>
      </details>
      {(filters.directory || on > 0 || filters.query) && (
        <div className="ss-active">
          {filters.directory && (
            <span className="ss-chip" title={filters.directory}>
              in {homePath(filters.directory)}
              <button aria-label="Search all folders" title="Search all folders" onClick={() => set({ directory: '' })}><X size={10} /></button>
            </span>
          )}
          <button className="sc-clear-filters" onClick={() => store.getState().clearFilters(pane)}><X size={12} /> Clear</button>
        </div>
      )}
      <FolderResults all={snapshot.sessions} matches={matches} selected={selected} open={open} menu={openMenu} directory={filters.directory} narrow={(directory) => set({ directory })} />
      {!matches.length && <div className="sc-empty">{busy || snapshot.pendingFiles > 0 ? 'Indexing transcripts…' : 'No sessions match these filters.'}</div>}
      {menu && (
        <Menu
          label="Session"
          at={{ top: menu.top, left: menu.left }}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', onSelect: () => store.getState().show(menu.key) },
            { label: 'Open to the side', onSelect: () => store.getState().show(menu.key, { side: true }) },
          ]}
        />
      )}
    </Pane>
  );
}
