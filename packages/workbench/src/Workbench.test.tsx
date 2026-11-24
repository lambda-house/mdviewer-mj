// @vitest-environment happy-dom
import { act, createContext, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistry, Workbench, pluginsTab, usePaneTypes, useSurfaceShown, type MenuItem, type Plugin, type WorkbenchProps } from './index';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const Theme = createContext('none');

function Shown({ name }: { name: string }) {
  return <p data-shown={name}>{`${name} ${useSurfaceShown() ? 'shown' : 'hidden'} in ${useContext(Theme)}`}</p>;
}

function PaneTypes({ registry }: { registry: PluginRegistry }) {
  return <p data-panes>{Object.keys(usePaneTypes(registry, 'documents')).join(',')}</p>;
}

const feature = (registry: PluginRegistry): Plugin => ({
  id: 'feature', name: 'Feature', required: true,
  setup(api) {
    api.contribute('workbench:wrapper', { id: 'theme', wrap: (children) => <Theme.Provider value="the feature's provider">{children}</Theme.Provider> });
    api.contribute('workbench:surface', { id: 'second', label: 'Second', order: 20, render: () => <Shown name="second" /> });
    api.contribute('workbench:surface', { id: 'first', label: 'First', order: 10, render: () => <><Shown name="first" /><PaneTypes registry={registry} /></> });
    api.contribute('workbench:pane-type', { view: 'documents', type: { type: 'documents', render: () => null } });
    api.contribute('workbench:pane-type', { view: 'journal', type: { type: 'journal-list', render: () => null } });
    api.contribute('workbench:settings-tab', { id: 'feature', label: 'Feature tab', group: 'Feature', render: () => <p>The feature’s settings</p> });
    api.contribute('workbench:overlay', { id: 'dialog', render: () => <div role="dialog" aria-label="Feature dialog" /> });
  },
});

const run = { first: vi.fn(), second: vi.fn(), everywhere: vi.fn() };
const menu: MenuItem<null>[] = [
  { id: 'first.thing', label: 'First Thing', shortcut: { mod: true, key: 'k' }, surface: 'first', run: run.first },
  { id: 'second.thing', label: 'Second Thing', shortcut: { mod: true, key: 'j' }, surface: 'second', enabled: () => false, run: run.second },
  { label: 'More', items: [{ id: 'app.everywhere', label: 'Everywhere', shortcut: { mod: true, key: 'u' }, run: run.everywhere }] },
];

function render(registry: PluginRegistry, props: Partial<WorkbenchProps<null>> = {}) {
  act(() => root.render(
    <Workbench
      registry={registry}
      surface="first"
      onSurface={() => {}}
      menu={menu}
      commandContext={() => null}
      useCommandContext={() => null}
      settings={{ open: false, onClose: () => {} }}
      className="app"
      {...props}
    />,
  ));
}

const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  return event;
};

describe('Workbench', () => {
  it('draws the surfaces, overlays and wrappers the plugins bring', () => {
    const registry = new PluginRegistry();
    registry.register(feature(registry));
    render(registry);
    expect([...host.querySelectorAll('.wb-topbar [class*="segmented__option"]')].map((b) => b.textContent)).toEqual(['First', 'Second']);
    expect(host.querySelector('[data-shown="first"]')?.textContent).toBe("first shown in the feature's provider");
    expect(host.querySelector('[data-shown="second"]')).toBeNull();
    expect(host.querySelector('[role="dialog"][aria-label="Feature dialog"]')?.closest('.app')).not.toBeNull();
    expect(host.querySelector('[data-panes]')?.textContent).toBe('documents');
  });

  it('lists the workbench’s tabs, then the plugins’, in its Settings dialog', () => {
    const registry = new PluginRegistry();
    registry.register(feature(registry));
    render(registry, { settings: { open: true, onClose: () => {} }, appearance: { theme: 'dark', setTheme: () => {} } });
    expect([...host.querySelectorAll('.settings-nav-item')].map((b) => b.textContent?.trim())).toEqual(['Appearance', 'Shortcuts', 'Feature tab']);
  });

  it('runs a command by its key on its surface, and keeps the browser’s action from a key that is a command elsewhere', () => {
    const registry = new PluginRegistry();
    registry.register(feature(registry));
    render(registry);
    expect(press('k').defaultPrevented).toBe(true);
    expect(run.first).toHaveBeenCalledTimes(1);
    // Another surface's command: nothing runs, nothing else happens
    expect(press('j').defaultPrevented).toBe(true);
    expect(run.second).not.toHaveBeenCalled();
    // In a submenu, on every surface
    press('u');
    expect(run.everywhere).toHaveBeenCalledTimes(1);
    // Not a command
    expect(press('q').defaultPrevented).toBe(false);
  });

  it('runs what the native menu asks for by id, when it is enabled', async () => {
    const registry = new PluginRegistry();
    let send: (id: string) => void = () => {};
    const stop = vi.fn();
    render(registry, { nativeMenu: async (handler) => { send = handler; return stop; } });
    await act(async () => {});
    run.everywhere.mockClear();
    send('app.everywhere');
    send('second.thing');
    send('no.such.command');
    expect(run.everywhere).toHaveBeenCalledTimes(1);
    expect(run.second).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(stop).toHaveBeenCalled();
    root = createRoot(host);
  });

  it('keeps a required plugin on, and out of the Plugins tab', () => {
    const registry = new PluginRegistry();
    registry.register(feature(registry));
    registry.register({ id: 'extra', name: 'Extra', setup: () => {} });
    registry.setEnabled('feature', false);
    expect(registry.isEnabled('feature')).toBe(true);
    expect(registry.items('workbench:surface')).toHaveLength(2);
    act(() => root.render(<>{pluginsTab(registry).render()}</>));
    expect(host.textContent).toContain('Extra');
    expect(host.textContent).not.toContain('Feature');
  });
});
