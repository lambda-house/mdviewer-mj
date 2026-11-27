import { useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { SettingRow } from '@lambda-house/ui';
import { SettingsSection, SettingsToggle, type SettingsTab } from '@lambda-house/workbench';
import { useReader, useReaderContext } from './host';

// The reader's tab in the Settings dialog (shared UI spec §5.6): how
// documents read, their text colours and code languages. It reads and writes
// the reader's settings; render it under the ReaderProvider.

function LanguageAliases() {
  const { store } = useReaderContext();
  const aliases = useReader((s) => s.settings.languageAliases);
  const [alias, setAlias] = useState('');
  const [language, setLanguage] = useState('');
  const set = (next: Record<string, string>) => store.getState().setSettings({ languageAliases: next });
  const add = () => {
    if (!alias.trim() || !language.trim()) return;
    set({ ...store.getState().settings.languageAliases, [alias.trim().toLowerCase()]: language.trim().toLowerCase() });
    setAlias('');
    setLanguage('');
  };
  const remove = (key: string) => {
    const next = { ...store.getState().settings.languageAliases };
    delete next[key];
    set(next);
  };
  return (
    <SettingsSection title="Language aliases" description={'Map code block language identifiers to syntax highlighters. For example, "sc" can be mapped to "scala".'}>
      <div className="settings-alias-list">
        {Object.keys(aliases).length === 0 ? (
          <div className="settings-alias-empty">No aliases configured.</div>
        ) : Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)).map(([key, lang]) => (
          <div key={key} className="settings-alias-item">
            <code className="settings-alias-key">{key}</code>
            <span className="settings-alias-arrow">&rarr;</span>
            <code className="settings-alias-value">{lang}</code>
            <button className="settings-alias-remove" onClick={() => remove(key)} title="Remove alias" aria-label={`Remove alias ${key}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="settings-alias-add">
        <input type="text" className="settings-alias-input" placeholder="Alias (e.g., sc)" aria-label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <span className="settings-alias-arrow">&rarr;</span>
        <input type="text" className="settings-alias-input" placeholder="Language (e.g., scala)" aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="settings-alias-add-btn" onClick={add} disabled={!alias.trim() || !language.trim()} title="Add alias" aria-label="Add alias"><Plus size={16} /></button>
      </div>
    </SettingsSection>
  );
}

export function DocumentSettings() {
  const { store } = useReaderContext();
  const settings = useReader((s) => s.settings);
  const set = store.getState().setSettings;
  return (
    <>
      <SettingsSection title="Documents" description="How documents read.">
        <div className="settings-card">
          <SettingRow
            label="Smooth scrolling"
            description="Animate mouse wheel scrolling instead of jumping line by line (trackpads always scroll natively)"
            control={<SettingsToggle label="Smooth scrolling" checked={settings.smoothScroll} onChange={(smoothScroll) => set({ smoothScroll })} />}
          />
          <SettingRow
            label="Load remote images"
            description="Show images from the web without asking. Loading them tells their server when you read a document"
            control={<SettingsToggle label="Load remote images" checked={settings.loadRemoteImages} onChange={(loadRemoteImages) => set({ loadRemoteImages })} />}
          />
          <SettingRow
            label="Text colour, dark theme"
            description="Primary text colour of rendered Markdown in the dark theme"
            control={<input type="color" aria-label="Text colour, dark theme" className="settings-color-input" value={settings.markdownTextColor} onChange={(e) => set({ markdownTextColor: e.target.value })} />}
          />
          <SettingRow
            label="Text colour, light theme"
            description="Primary text colour of rendered Markdown in the light theme"
            control={<input type="color" aria-label="Text colour, light theme" className="settings-color-input" value={settings.markdownTextColorLight} onChange={(e) => set({ markdownTextColorLight: e.target.value })} />}
          />
        </div>
      </SettingsSection>
      <LanguageAliases />
    </>
  );
}

/** The reader's Settings tab. */
export function readerSettingsTab(): SettingsTab {
  return { id: 'documents', label: 'Documents', icon: <FileText size={15} />, group: 'Documents', order: 40, render: () => <DocumentSettings /> };
}
