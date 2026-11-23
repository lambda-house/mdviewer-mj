// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildMenu, commandForKey, menuCommands } from './commands';

const commands = menuCommands(buildMenu({ openFile: () => {}, openFolder: () => {}, reopenClosedTab: () => {} }));
const press = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, ...init });

describe('the commands of each surface', () => {
  it('leave the documents alone while the Journal is shown', () => {
    expect(commandForKey(commands, press('w', { ctrlKey: true }), 'documents')?.id).toBe('tabs.close');
    expect(commandForKey(commands, press('w', { ctrlKey: true }), 'journal')).toBeUndefined();
    expect(commandForKey(commands, press('f', { ctrlKey: true }), 'journal')).toBeUndefined();
  });

  it('keep what works anywhere: the palette, settings, moving between panes', () => {
    for (const surface of ['documents', 'journal']) {
      expect(commandForKey(commands, press('p', { ctrlKey: true, shiftKey: true }), surface)?.id).toBe('app.commandPalette');
      expect(commandForKey(commands, press('F6'), surface)?.id).toBe('layout.focusNext');
      expect(commandForKey(commands, press('F6', { shiftKey: true }), surface)?.id).toBe('layout.focusPrevious');
    }
  });

  it('split the document on Mod+\\, and the focused pane from the menu', () => {
    expect(commandForKey(commands, press('\\', { ctrlKey: true }), 'documents')?.id).toBe('view.splitRight');
    expect(commands.map((c) => c.id)).toEqual(expect.arrayContaining(['layout.splitRight', 'layout.splitDown', 'layout.closePane', 'layout.reset', 'journal.refresh', 'journal.newList']));
  });
});
