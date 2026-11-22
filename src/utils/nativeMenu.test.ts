// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMenu, commandForKey, menuCommands } from './commands';

// The native menu (src-tauri/src/main.rs) has its own list of items; the ones
// Rust does not handle itself reach the frontend as "menu-command" events and
// run the command with that id. A native item without a command does nothing.
const mainRs = readFileSync(join(import.meta.dirname, '../../src-tauri/src/main.rs'), 'utf8');

const nativeIds = [...mainRs.matchAll(/\.text\("([^"]+)"|with_id\("([^"]+)"/g)].map((m) => m[1] ?? m[2]);
const handlerStart = mainRs.indexOf('on_menu_event');
const handledInRust = [...mainRs.slice(handlerStart, mainRs.indexOf('id =>', handlerStart)).matchAll(/"([^"]+)"\s*=>/g)].map((m) => m[1]);

const commands = menuCommands(buildMenu({ openFile: () => {}, openFolder: () => {}, reopenClosedTab: () => {} }));

describe('the native menu', () => {
  it('was found in main.rs', () => {
    expect(nativeIds.length).toBeGreaterThan(3);
    expect(handledInRust).toContain('help.docs');
  });

  it('has a command for every item the frontend runs', () => {
    const missing = nativeIds.filter((id) => !handledInRust.includes(id) && !commands.some((c) => c.id === id));
    expect(missing).toEqual([]);
  });
});

describe('the command palette', () => {
  it('opens on Ctrl+Shift+P (⇧⌘P), and Ctrl+S (⌘S) stays Save', () => {
    const press = (init: KeyboardEventInit) => commandForKey(commands, new KeyboardEvent('keydown', init))?.id;
    expect(press({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })).toBe('app.commandPalette');
    expect(press({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true })).toBe('app.commandPalette');
    expect(press({ key: 's', metaKey: true })).toBe('file.save');
    expect(press({ key: 'p', ctrlKey: true })).toBe('search.filterFiles');
  });
});
