// @vitest-environment happy-dom
import { act, createContext, useContext, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dragsWindow } from './dragRegion.testing';
import {
  PluginRegistry, ShellTools, ShellViews, Workbench, pluginsTab, useCommandTitle, usePaneTypes, useSurfaceShown, useViews, windowCommands,
  type MenuItem, type Plugin, type Theme, type WorkbenchProps,
} from './index';

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
      settings={{ open: false, onOpenChange: () => {} }}
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
    render(registry, { settings: { open: true, onOpenChange: () => {} }, appearance: { theme: 'dark', setTheme: () => {} } });
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

  it('draws the palette, settings and theme at the end of the bar, named after their commands', () => {
    const registry = new PluginRegistry();
    const openPalette = vi.fn();
    const openChange = vi.fn();
    const setTheme = vi.fn();
    const win = windowCommands({
      palette: { open: openPalette },
      settings: { open: () => openChange(true) },
      theme: { get: () => 'dark', set: setTheme },
      statusBar: { pinned: () => false, setPinned: () => {} },
    });
    render(registry, {
      menu: [win.palette, win.settings],
      palette: { open: false, onOpenChange: openPalette },
      settings: { open: false, onOpenChange: openChange },
      appearance: { theme: 'dark', setTheme },
    });
    const end = [...host.querySelectorAll<HTMLButtonElement>('.wb-topbar > :last-child .wb-tool')];
    expect(end.map((b) => b.title)).toEqual(['Command Palette (Ctrl+Shift+P)', 'Settings (Ctrl+,)', 'Switch to light theme']);
    act(() => end.forEach((b) => b.click()));
    expect(openPalette).toHaveBeenCalledWith(true);
    expect(openChange).toHaveBeenCalledWith(true);
    expect(setTheme).toHaveBeenCalledWith('light');
    // The main menu's button is a tool of the bar too
    expect(host.querySelector('.wb-main-menu > button')?.className).toBe('wb-tool');
  });

  it('makes the bar a title bar on request: room for the traffic lights, and only its own empty space drags', () => {
    const registry = new PluginRegistry();
    // A surface's tools as plugins bring them: a hover control and a popover are not buttons, a group has gaps
    registry.register({
      id: 'tools', name: 'Tools', required: true,
      setup(api) {
        api.contribute('workbench:surface', {
          id: 'first', label: 'First', order: 10, render: () => (
            <ShellTools>
              <div className="wb-tool-group"><button className="wb-tool">A</button><span className="wb-tool-separator" /><div className="hover">50%</div></div>
              <details><summary>Summary</summary><div className="popover"><p>Figures</p></div></details>
            </ShellTools>
          ),
        });
        api.contribute('workbench:surface', { id: 'second', label: 'Second', order: 20, render: () => null });
      },
    });
    const bar = () => host.querySelector<HTMLElement>('.wb-topbar')!;

    render(registry, { titleBar: 'overlay', palette: { open: false, onOpenChange: () => {} }, appearance: { theme: 'dark', setTheme: () => {} } });
    expect(bar().getAttribute('data-titlebar')).toBe('overlay');
    expect(bar().style.paddingLeft).toBe('88px');
    expect(dragsWindow(bar())).toBe(true);
    expect(dragsWindow(bar().querySelector('.wb-topbar__spacer')!)).toBe(true);
    // The main menu opens in place: its frame and separators are no drag either
    act(() => bar().querySelector<HTMLButtonElement>('.wb-main-menu > button')!.click());
    expect(bar().querySelector('[role="menu"]')).not.toBeNull();
    const inside = [...bar().querySelectorAll(':scope > :not(.wb-topbar__spacer), :scope > :not(.wb-topbar__spacer) *')];
    expect(inside.length).toBeGreaterThan(15);
    for (const el of inside) expect(dragsWindow(el), el.outerHTML.slice(0, 80)).toBe(false);

    // Full screen: no room for the lights (macOS hides them) and no drag region
    render(registry, { titleBar: 'fullscreen' });
    expect(bar().getAttribute('data-titlebar')).toBe('fullscreen');
    expect(bar().style.paddingLeft).toBe('');
    expect(dragsWindow(bar())).toBe(false);
    // A native title bar: the bar as it was
    render(registry, { titleBar: 'native' });
    expect(bar().hasAttribute('data-titlebar')).toBe(false);
    expect(bar().getAttribute('style')).toBeNull();
    expect(host.querySelector('[data-tauri-drag-region]')).toBeNull();
  });

  it('names a command’s key in a tooltip, from the menu', () => {
    function Titles() {
      return <p data-titles>{[useCommandTitle('first.thing', 'First'), useCommandTitle('app.everywhere'), useCommandTitle('no.such', 'Plain')].join(' | ')}</p>;
    }
    const registry = new PluginRegistry();
    registry.register({ id: 'titles', name: 'Titles', setup: (api) => api.contribute('workbench:surface', { id: 'first', label: 'First', order: 1, render: () => <Titles /> }) });
    render(registry);
    expect(host.querySelector('[data-titles]')?.textContent).toBe('First (Ctrl+K) | Everywhere (Ctrl+U) | Plain');
    // Outside a Workbench: the label alone
    act(() => root.render(<Titles />));
    expect(host.textContent).toBe('First |  | Plain');
  });

  it('draws no palette button without a palette, and a disabled one while it can’t open', () => {
    const registry = new PluginRegistry();
    render(registry);
    expect(host.querySelectorAll('.wb-topbar > :last-child .wb-tool')).toHaveLength(1);
    expect(host.querySelector('.wb-topbar > :last-child .wb-tool')?.getAttribute('title')).toBe('Settings');
    render(registry, { palette: { open: false, onOpenChange: () => {}, enabled: false } });
    expect(host.querySelector<HTMLButtonElement>('.wb-topbar > :last-child .wb-tool')?.disabled).toBe(true);
  });

  it('lists what the providers find, in their order, then the commands of the shown surface', () => {
    const registry = new PluginRegistry();
    const opened = vi.fn();
    let filter = 'all';
    registry.register({
      id: 'sources', name: 'Sources',
      setup(api) {
        api.contribute('workbench:palette-provider', {
          id: 'files', order: 20,
          useResults: (query) => ({ items: ['notes.md', 'todo.md'].filter((name) => name.includes(query)).map((name) => ({ id: name, group: 'Files', label: name, run: () => opened(name) })) }),
        });
        api.contribute('workbench:palette-provider', {
          id: 'tabs', order: 10,
          useResults: () => {
            // A provider's data may come from hooks
            const [count] = useState(1);
            return {
              items: [{ id: 'tab', group: 'Open tabs', label: `readme.md (${count})`, run: () => {} }],
              toolbar: <button type="button" data-filter onClick={() => { filter = 'tabs'; }}>{filter}</button>,
            };
          },
        });
        api.contribute('workbench:palette-provider', { id: 'elsewhere', surface: 'second', useResults: () => ({ items: [{ id: 'x', group: 'Second', label: 'Second only', run: () => {} }] }) });
      },
    });
    const openChange = vi.fn();
    render(registry, { palette: { open: true, onOpenChange: openChange, placeholder: 'Search everything…' } });
    const dialog = () => document.querySelector('.cmd-panel');
    const groups = () => [...document.querySelectorAll('.cmd-group')].map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('.cmd-item__label')].map((l) => l.textContent)]);
    expect(dialog()?.querySelector('input')?.placeholder).toBe('Search everything…');
    // The second surface's provider and command are left out; the disabled command too
    expect(groups()).toEqual([
      ['Open tabs', ['readme.md (1)']],
      ['Files', ['notes.md', 'todo.md']],
      ['Commands', ['First Thing', 'Everywhere']],
    ]);
    expect(dialog()?.querySelector('.cmd-subbar [data-filter]')?.textContent).toBe('all');
    expect(dialog()?.querySelector('.cmd-preview')).toBeNull();
    const input = dialog()!.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'todo');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(groups()).toEqual([['Open tabs', ['readme.md (1)']], ['Files', ['todo.md']]]);
    act(() => document.querySelectorAll<HTMLElement>('.cmd-item')[1].click());
    expect(openChange).toHaveBeenCalledWith(false);
    expect(opened).toHaveBeenCalledWith('todo.md');
    // Not drawn while it can't open
    render(registry, { palette: { open: true, onOpenChange: openChange, enabled: false } });
    expect(dialog()).toBeNull();
  });

  it('shows a preview panel when a provider has previews', () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'sessions', name: 'Sessions',
      setup: (api) => api.contribute('workbench:palette-provider', {
        id: 'sessions', preview: { empty: <p data-empty>Select a session</p> },
        useResults: () => ({ items: [{ id: 's', group: 'Sessions', label: 'Fix the build', preview: <p data-preview>In Live</p>, run: () => {} }] }),
      }),
    });
    render(registry, { palette: { open: true, onOpenChange: () => {} } });
    expect(document.querySelector('.cmd-preview [data-preview]')?.textContent).toBe('In Live');
  });

  it('draws a surface’s views in their order', () => {
    const registry = new PluginRegistry();
    function Views() {
      const views = useViews(registry, 'first');
      return <ShellViews label="Sessions view" views={views} value="live" onChange={() => {}} />;
    }
    registry.register({
      id: 'views', name: 'Views',
      setup(api) {
        api.contribute('workbench:surface', { id: 'first', label: 'Sessions', render: () => <Views /> });
        api.contribute('workbench:view', { surface: 'first', id: 'board', label: 'Board', order: 30, render: () => <p>board</p> });
        api.contribute('workbench:view', { surface: 'first', id: 'live', label: 'Live', order: 10, render: () => <p data-live>live</p> });
        api.contribute('workbench:view', { surface: 'documents', id: 'other', label: 'Other', render: () => null });
      },
    });
    registry.register({ id: 'extra', name: 'Extra', setup: (api) => api.contribute('workbench:view', { surface: 'first', id: 'extra', label: 'Extra', order: 20, render: () => null }) });
    render(registry);
    const options = () => [...host.querySelectorAll('.wb-topbar [aria-label="Sessions view"] [class*="segmented__option"]')].map((b) => b.textContent);
    expect(options()).toEqual(['Live', 'Extra', 'Board']);
    expect(host.querySelector('[data-live]')).not.toBeNull();
    // A plugin turned off takes its view away
    act(() => registry.setEnabled('extra', false));
    expect(options()).toEqual(['Live', 'Board']);
  });

  it('closes Settings through onOpenChange', () => {
    const registry = new PluginRegistry();
    const openChange = vi.fn();
    render(registry, { settings: { open: true, onOpenChange: openChange } });
    act(() => host.ownerDocument.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click());
    expect(openChange).toHaveBeenCalledWith(false);
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

describe('windowCommands', () => {
  const make = (canOpen?: () => boolean) => {
    let theme: Theme = 'dark';
    let pinned = false;
    const open = vi.fn();
    const win = windowCommands({
      palette: { open, enabled: canOpen, label: 'Command Panel…' },
      settings: { open: () => {} },
      theme: { get: () => theme, set: (t) => { theme = t; } },
      statusBar: { pinned: () => pinned, setPinned: (p) => { pinned = p; } },
    });
    return { win, open, theme: () => theme, pinned: () => pinned };
  };

  it('switches the theme and pins the status bar, checked as they are', () => {
    const { win, theme, pinned } = make();
    expect([win.darkTheme.checked?.(null), win.lightTheme.checked?.(null)]).toEqual([true, false]);
    win.lightTheme.run();
    expect(theme()).toBe('light');
    expect(win.lightTheme.checked?.(null)).toBe(true);
    win.pinStatusBar.run();
    expect(pinned()).toBe(true);
    expect(win.pinStatusBar.checked?.(null)).toBe(true);
  });

  it('opens the palette only while it can, and leaves it out of itself', () => {
    let can = false;
    const { win, open } = make(() => can);
    expect(win.palette.label).toBe('Command Panel…');
    expect(win.palette.palette).toBe(false);
    expect(win.palette.enabled?.(null)).toBe(false);
    win.palette.run();
    expect(open).not.toHaveBeenCalled();
    can = true;
    win.palette.run();
    expect(open).toHaveBeenCalledTimes(1);
    // Without a condition it always can
    expect(make().win.palette.enabled).toBeUndefined();
  });
});
