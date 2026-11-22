// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ariaShortcut, commandForKey, commandItems, createMenuStore, formatShortcut, MainMenu, matchesQuery, menuCommands, Palette,
  type Command, type MenuItem, type PaletteItem,
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
  document.body.innerHTML = '';
});

const render = (node: ReactNode) => act(() => root.render(node));
const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
const key = (target: EventTarget, init: KeyboardEventInit) => act(() => { target.dispatchEvent(press(init)); });
const all = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));

interface State { dirty: boolean; toc: boolean }
const run = vi.fn();
const menu: MenuItem<State>[] = [
  { id: 'file.save', label: 'Save File', shortcut: { mod: true, key: 's' }, enabled: (s) => s.dirty, run: () => run('save') },
  { id: 'file.saveAll', label: 'Save All…', shortcut: { mod: true, shift: true, key: 's' }, run: () => run('saveAll') },
  'separator',
  {
    label: 'View',
    items: [
      { id: 'view.toc', label: 'Table of Contents', checked: (s) => s.toc, run: () => run('toc') },
      { id: 'app.palette', label: 'Command Palette…', shortcut: { mod: true, shift: true, key: 'p' }, palette: false, run: () => run('palette') },
    ],
  },
];

beforeEach(() => run.mockClear());

describe('shortcuts', () => {
  const commands = menuCommands(menu);
  const find = (init: KeyboardEventInit) => commandForKey(commands, press(init))?.id;

  it('match Ctrl or Cmd, Shift for letters, and the physical key on other layouts', () => {
    expect(find({ key: 's', ctrlKey: true })).toBe('file.save');
    expect(find({ key: 's', metaKey: true })).toBe('file.save');
    expect(find({ key: 'S', metaKey: true, shiftKey: true })).toBe('file.saveAll');
    expect(find({ key: 'ы', code: 'KeyS', ctrlKey: true })).toBe('file.save');
    expect(find({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })).toBe('app.palette');
    expect(find({ key: 'з', code: 'KeyP', ctrlKey: true, shiftKey: true })).toBe('app.palette');
    expect(find({ key: 's' })).toBeUndefined();
    expect(find({ key: 's', ctrlKey: true, altKey: true })).toBeUndefined();
    expect(find({ key: '' })).toBeUndefined();
  });

  it('are written as the platform writes them', () => {
    expect(formatShortcut({ mod: true, shift: true, key: 'p' }, 'macos')).toBe('⇧⌘P');
    expect(formatShortcut({ mod: true, shift: true, key: 'p' }, 'linux')).toBe('Ctrl+Shift+P');
    expect(formatShortcut({ alt: true, key: 'ArrowLeft' }, 'windows')).toBe('Alt+Left');
    expect(ariaShortcut({ mod: true, shift: true, key: 'p' }, 'macos')).toBe('Meta+Shift+P');
    expect(ariaShortcut({ mod: true, shift: true, key: 'p' }, 'linux')).toBe('Control+Shift+P');
  });
});

describe('commandItems', () => {
  it('lists enabled commands the palette may show, matched by label or submenu', () => {
    const labels = (query: string, dirty = false) => commandItems(menu, { dirty, toc: true }, query).map((item) => item.label);
    expect(labels('')).toEqual(['Save All…', 'Table of Contents']);
    expect(labels('', true)).toEqual(['Save File', 'Save All…', 'Table of Contents']);
    expect(labels('view')).toEqual(['Table of Contents']);
    expect(labels('save all')).toEqual(['Save All…']);
    expect(commandItems(menu, { dirty: true, toc: true }, 'save file')[0]).toMatchObject({ group: 'Commands', hint: undefined });
    expect(matchesQuery('con tab', 'Table of Contents')).toBe(true);
  });
});

describe('createMenuStore', () => {
  it('tells its subscribers when the menu changes', () => {
    const store = createMenuStore<State>();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set(menu);
    store.set(menu);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(menu);
    stop();
  });
});

describe('Palette', () => {
  const items: PaletteItem[] = [
    { id: 'b', group: 'Tabs', label: 'README.md', run: () => run('tab') },
    { id: 'a', group: 'Commands', label: 'Save All…', shortcut: '⇧⌘S', run: () => run('saveAll') },
    { id: 'c', group: 'Commands', label: 'Settings…', hint: 'App', run: () => run('settings') },
  ];
  const setup = (props: Partial<Parameters<typeof Palette>[0]> = {}) => {
    const onClose = vi.fn();
    const calls: string[] = [];
    onClose.mockImplementation(() => calls.push('close'));
    run.mockImplementation((what: string) => calls.push(what));
    render(<Palette open onClose={onClose} query="" onQueryChange={() => {}} items={items} groups={['Commands']} {...props} />);
    return { onClose, calls, panel: document.querySelector<HTMLElement>('[role="dialog"]')! };
  };

  it('lists the groups in the given order, then the others', () => {
    setup();
    expect(all('.cmd-group').map((g) => g.getAttribute('aria-label'))).toEqual(['Commands', 'Tabs']);
    expect(all('[role="option"]').map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(document.querySelector('.cmd-preview')).toBeNull();
  });

  it('moves with the arrows and runs the selected item after closing', () => {
    const { calls, panel } = setup();
    key(panel, { key: 'ArrowDown' });
    key(panel, { key: 'ArrowDown' });
    expect(all('[role="option"]')[2].getAttribute('aria-selected')).toBe('true');
    key(panel, { key: 'Enter' });
    expect(calls).toEqual(['close', 'tab']);
  });

  it('closes on Escape and keeps keys from the app', () => {
    const appShortcut = vi.fn();
    window.addEventListener('keydown', appShortcut);
    const { onClose, panel } = setup();
    key(panel, { key: 'Escape' });
    key(panel, { key: 's', ctrlKey: true });
    window.removeEventListener('keydown', appShortcut);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(appShortcut).not.toHaveBeenCalled();
  });

  it('shows a preview panel when asked, and says when nothing matches', () => {
    setup({ showPreview: true });
    expect(document.querySelector('.cmd-preview__title')?.textContent).toBe('Save All…');
    render(<Palette open onClose={() => {}} query="zzz" onQueryChange={() => {}} items={[]} />);
    expect(document.querySelector('.cmd-empty')?.textContent).toContain('zzz');
  });
});

describe('MainMenu', () => {
  const Menu = ({ dirty }: { dirty: boolean }) => <MainMenu<State> items={menu} useCommandContext={() => ({ dirty, toc: true })} />;
  const open = () => act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')!.click());

  it('shows the commands with their shortcuts and check marks, and runs one on Enter', () => {
    render(<Menu dirty={false} />);
    open();
    const rows = all('[role="menu"] > .ui-menu__item, [role="menu"] > .wb-main-menu__submenu > .ui-menu__item');
    expect(rows.map((r) => r.querySelector('.ui-menu__label')?.textContent)).toEqual(['Save File', 'Save All…', 'View']);
    expect(rows[0].getAttribute('aria-disabled')).toBe('true');
    expect(rows[1].querySelector('.ui-menu__shortcut')?.textContent).toMatch(/S$/);

    // The disabled row is skipped
    key(window, { key: 'ArrowDown' });
    key(window, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('saveAll');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens a submenu with ArrowRight and shows what is checked', () => {
    render(<Menu dirty />);
    open();
    key(window, { key: 'End' });
    key(window, { key: 'ArrowRight' });
    const toc = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
    expect(toc.getAttribute('aria-checked')).toBe('true');
    key(window, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('toc');
  });
});

// Types only: a command's context is the app's
const typed: Command<State> = { id: 'x', label: 'X', enabled: (s) => s.dirty, run: () => {} };
void typed;
