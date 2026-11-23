import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Palette, Puzzle, X } from 'lucide-react';
import { Badge, Button, Kbd, Notice, Segmented, SettingRow } from '@lambda-house/ui';
import { formatShortcut, menuEntries, type MenuItem } from './commands';
import { usePlugins, type PluginRegistry } from './plugins';

// The one Settings dialog (shared UI spec §5.6): a sidebar of tabs in
// groups, the chosen tab beside it. The workbench, the features and the app
// each bring their tabs; this is Agent MCR's layout. Styles: workbench.css.

export interface SettingsTab {
  id: string;
  label: string;
  icon?: ReactNode;
  /** The sidebar heading it is listed under ("Application", "Documents"). */
  group: string;
  /** Lower first within the dialog; 100 by default. */
  order?: number;
  render: () => ReactNode;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  tabs: SettingsTab[];
  /** The tab it opens on (the first one by default). */
  initialTab?: string;
}

/** Groups in the order their first tab comes. */
function grouped(tabs: SettingsTab[]): Array<{ group: string; tabs: SettingsTab[] }> {
  const sorted = tabs.map((tab, index) => ({ tab, index })).sort((a, b) => (a.tab.order ?? 100) - (b.tab.order ?? 100) || a.index - b.index).map((t) => t.tab);
  const groups: Array<{ group: string; tabs: SettingsTab[] }> = [];
  for (const tab of sorted) {
    const found = groups.find((g) => g.group === tab.group);
    if (found) found.tabs.push(tab);
    else groups.push({ group: tab.group, tabs: [tab] });
  }
  return groups;
}

export function SettingsDialog({ open, onClose, tabs, initialTab }: SettingsDialogProps) {
  const groups = useMemo(() => grouped(tabs), [tabs]);
  const first = groups[0]?.tabs[0]?.id ?? '';
  const [active, setActive] = useState(initialTab ?? first);
  const shown = tabs.find((tab) => tab.id === active) ?? tabs.find((tab) => tab.id === first);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay settings-overlay" onClick={onClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-header-title"><h2>Settings</h2></div>
          <div className="settings-header-actions">
            <Kbd>Esc</Kbd>
            <Button variant="ghost" size="sm" className="settings-close" onClick={onClose} title="Close (Escape)" aria-label="Close settings" icon={<X size={15} />} />
          </div>
        </div>
        <div className="settings-content">
          <nav className="settings-sidebar" aria-label="Settings sections">
            {groups.map(({ group, tabs: list }) => (
              <Fragment key={group}>
                <div className="settings-nav-group">{group}</div>
                {list.map((tab) => (
                  <button key={tab.id} type="button" className={`settings-nav-item ${shown?.id === tab.id ? 'active' : ''}`} aria-current={shown?.id === tab.id ? 'page' : undefined} onClick={() => setActive(tab.id)}>
                    {tab.icon ?? <Puzzle size={15} />}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>
          <div className="settings-main">{shown?.render()}</div>
        </div>
      </div>
    </div>
  );
}

/** A tab's section: its title, a line about it, then its rows. */
export function SettingsSection({ title, description, badge, children }: { title: ReactNode; description?: ReactNode; badge?: ReactNode; children?: ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <div className="settings-section-title-row"><h3>{title}</h3>{badge}</div>
        {description && <p className="settings-section-description">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** A switch for a setting row. */
export function SettingsToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-slider" />
    </label>
  );
}

// ============================================================
// The workbench's own tabs
// ============================================================

/** Appearance: the theme. */
export function appearanceTab({ theme, setTheme }: { theme: 'dark' | 'light'; setTheme: (theme: 'dark' | 'light') => void }): SettingsTab {
  return {
    id: 'appearance', label: 'Appearance', icon: <Palette size={15} />, group: 'Application', order: 10,
    render: () => (
      <SettingsSection title="Appearance" description="How the window looks.">
        <div className="settings-card">
          <SettingRow
            label="Theme"
            description="Dark or light colours for the whole window"
            control={<Segmented label="Theme" value={theme} onChange={(value) => setTheme(value as 'dark' | 'light')} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />}
          />
        </div>
      </SettingsSection>
    ),
  };
}

/** Shortcuts: every command that has one, by the menu it is in. */
export function shortcutsTab<C>(menu: () => MenuItem<C>[]): SettingsTab {
  return {
    id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={15} />, group: 'Application', order: 20,
    render: () => {
      const entries = menuEntries(menu()).filter(({ command }) => command.shortcut);
      return (
        <SettingsSection title="Keyboard shortcuts" description="The commands of the main menu that have a key.">
          <div className="settings-card">
            {entries.map(({ command, submenu }) => (
              <SettingRow key={command.id} label={command.label} description={submenu || undefined} control={<Kbd>{formatShortcut(command.shortcut!)}</Kbd>} />
            ))}
          </div>
        </SettingsSection>
      );
    },
  };
}

function PluginsSettings({ registry, note }: { registry: PluginRegistry; note?: ReactNode }) {
  usePlugins(registry);
  const plugins = registry.listPlugins();
  const enabled = plugins.filter((p) => p.enabled).length;
  return (
    <SettingsSection
      title="Plugins"
      badge={plugins.length > 0 && <Badge tone="neutral">{`${enabled} / ${plugins.length} active`}</Badge>}
      description="Enable or disable built-in and local plugins. Changes apply immediately without restarting."
    >
      {plugins.length === 0 ? (
        <div className="settings-card settings-card--padded"><p className="settings-section-description">No plugins registered.</p></div>
      ) : (
        <div className="settings-plugin-list">
          {plugins.map((plugin) => (
            <div key={plugin.id} className={`settings-plugin-card ${plugin.enabled ? 'is-enabled' : 'is-disabled'}`}>
              <div className="settings-plugin-icon" aria-hidden="true"><Puzzle size={16} /></div>
              <div className="settings-plugin-body">
                <div className="settings-plugin-title">
                  <span className="settings-plugin-name">{plugin.name}</span>
                  {plugin.version && <Badge tone="neutral">{`v${plugin.version}`}</Badge>}
                  <Badge tone={plugin.enabled ? 'ok' : 'neutral'} dot>{plugin.enabled ? 'Enabled' : 'Disabled'}</Badge>
                  <span className="settings-plugin-id">{plugin.id}</span>
                </div>
                {plugin.description && <p className="settings-plugin-desc">{plugin.description}</p>}
              </div>
              <SettingsToggle label={`Toggle ${plugin.name}`} checked={plugin.enabled} onChange={(on) => registry.setEnabled(plugin.id, on)} />
            </div>
          ))}
        </div>
      )}
      {note && <Notice tone="info" title="Local plugins">{note}</Notice>}
    </SettingsSection>
  );
}

/** Plugins: the registry's plugins, each to switch on or off. */
export function pluginsTab(registry: PluginRegistry, note?: ReactNode): SettingsTab {
  return { id: 'plugins', label: 'Plugins', icon: <Puzzle size={15} />, group: 'Application', order: 30, render: () => <PluginsSettings registry={registry} note={note} /> };
}
