import { expect, it, vi } from 'vitest';
import { documentWindowStorage } from './documentWindow';

it('inherits display preferences without restoring or overwriting the main workspace', () => {
  const getItem = vi.fn(() => JSON.stringify({version:4,state:{theme:'light',zoom:125,tabs:[{path:'/main.md'}],directories:['/work'],editMode:true}}));
  const storage = documentWindowStorage({getItem});
  const {state} = JSON.parse(storage.getItem());
  expect(state.theme).toBe('light');
  expect(state.zoom).toBe(125);
  expect(state.tabs).toBeUndefined();
  expect(state.directories).toBeUndefined();
  expect(state.editMode).toBe(false);
  expect(state.filePanelVisible).toBe(false);
  storage.setItem();
  storage.removeItem();
  expect(JSON.parse(storage.getItem()).state).toEqual(state);
});

it('can open with defaults when persisted preferences are malformed', () => {
  expect(JSON.parse(documentWindowStorage({getItem:()=>'{broken'}).getItem()).state.editMode).toBe(false);
});
