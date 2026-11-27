// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ReaderProvider, type ReaderHost } from './host';
import { DocumentSettings } from './ReaderSettings';
import { createReaderStore } from './store';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('changes the reader settings: toggles and language aliases', () => {
  const store = createReaderStore({ storage: null, name: 'test' });
  act(() => root.render(<ReaderProvider reader={{ store, host: {} as ReaderHost }}><DocumentSettings /></ReaderProvider>));
  const smooth = host.querySelector<HTMLInputElement>('input[aria-label="Smooth scrolling"]')!;
  const before = store.getState().settings.smoothScroll;
  act(() => smooth.click());
  expect(store.getState().settings.smoothScroll).toBe(!before);
  const type = (label: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  type('Alias', 'KT');
  type('Language', 'Kotlin');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Add alias"]')!.click());
  expect(store.getState().settings.languageAliases.kt).toBe('kotlin');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove alias kt"]')!.click());
  expect(store.getState().settings.languageAliases.kt).toBeUndefined();
});
