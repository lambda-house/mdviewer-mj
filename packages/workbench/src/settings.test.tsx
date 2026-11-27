// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog, shortcutsTab, type SettingsTab } from './index';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const tab = (id: string, group: string, order?: number): SettingsTab => ({ id, label: id, group, order, render: () => <p data-tab={id}>{id} content</p> });

describe('the Settings dialog', () => {
  it('lists the tabs by group and order, and shows the chosen one', () => {
    const tabs = [tab('folders', 'Documents', 41), tab('appearance', 'Application', 10), tab('documents', 'Documents', 40), tab('updates', 'Application', 90)];
    act(() => root.render(<SettingsDialog open onClose={() => {}} tabs={tabs} />));
    const sidebar = () => [...host.querySelectorAll('.settings-sidebar > *')].map((e) => e.textContent);
    expect(sidebar()).toEqual(['Application', 'appearance', 'updates', 'Documents', 'documents', 'folders']);
    expect(host.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('appearance');
    act(() => [...host.querySelectorAll<HTMLButtonElement>('.settings-nav-item')].find((b) => b.textContent === 'folders')!.click());
    expect(host.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('folders');
    expect(host.querySelector('.settings-nav-item.active')?.textContent).toBe('folders');
  });

  it('closes on Escape, and is not there closed', () => {
    const onClose = vi.fn();
    act(() => root.render(<SettingsDialog open onClose={onClose} tabs={[tab('a', 'G')]} />));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
    act(() => root.render(<SettingsDialog open={false} onClose={onClose} tabs={[tab('a', 'G')]} />));
    expect(host.querySelector('.settings-modal')).toBeNull();
  });

  it('lists the commands that have a key', () => {
    const menu = [{ label: 'File', items: [{ id: 'save', label: 'Save', shortcut: { mod: true, key: 's' }, run: () => {} }, { id: 'quiet', label: 'Quiet', run: () => {} }] }];
    act(() => root.render(<SettingsDialog open onClose={() => {}} tabs={[shortcutsTab(() => menu)]} />));
    expect(host.textContent).toContain('Save');
    expect(host.textContent).not.toContain('Quiet');
  });
});
