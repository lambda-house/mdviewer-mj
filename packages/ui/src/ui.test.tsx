// @vitest-environment happy-dom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, EmptyState, Menu, PaneFrame, Segmented, Splitter, Tabs, ACTION_BUTTON_FIRST } from './index';

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
const key = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
const all = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));

describe('Button', () => {
  it('is a plain button, square with only an icon, spinning when busy', () => {
    render(<><Button icon={<i />} aria-label="Refresh" busy /><Button>Save</Button></>);
    const [iconOnly, text] = all('button');
    expect(iconOnly.getAttribute('type')).toBe('button');
    expect(iconOnly.className).toContain('ui-btn--icon');
    expect(iconOnly.className).toContain('ui-btn--busy');
    expect(text.className).not.toContain('ui-btn--icon');
  });
});

describe('Segmented', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] as const;

  it('as navigation marks the current place', () => {
    const onChange = vi.fn();
    render(<Segmented label="Workspace" options={[...options]} value="b" onChange={onChange} />);
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Workspace');
    expect(all('button').map((b) => b.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    act(() => all('button')[2].click());
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('as a choice is a radio group that arrows move through', () => {
    const onChange = vi.fn();
    render(<Segmented kind="choice" label="Filter" options={[...options]} value="c" onChange={onChange} />);
    const radios = all('[role="radio"]');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    key(radios[2], 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('a');
    expect(document.activeElement).toBe(radios[0]);
  });
});

describe('Tabs', () => {
  it('selects with arrows, Home and End; only the selected tab is tabbable', () => {
    const onChange = vi.fn();
    render(<Tabs label="Details" tabs={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 3 }, { value: 'c', label: 'C' }]} value="a" onChange={onChange} />);
    const tabs = all('[role="tab"]');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[1].textContent).toBe('B3');
    key(tabs[0], 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('c');
    key(tabs[0], 'End');
    expect(onChange).toHaveBeenLastCalledWith('c');
    key(tabs[0], 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});

describe('Menu', () => {
  const setup = () => {
    const onClose = vi.fn();
    const calls: string[] = [];
    onClose.mockImplementation(() => calls.push('close'));
    const anchor = createRef<HTMLButtonElement>();
    render(<>
      <button ref={anchor}>trigger</button>
      <Menu
        at={{ top: 10, left: 10 }}
        onClose={onClose}
        anchorRef={anchor}
        items={[
          { label: 'Disabled', onSelect: () => calls.push('disabled'), disabled: true },
          { label: 'Copy', onSelect: () => calls.push('copy') },
          'separator',
          { label: 'Close', onSelect: () => calls.push('closeTab') },
        ]}
      />
    </>);
    return { onClose, calls, anchor };
  };

  it('focuses the first enabled item and moves between enabled items', () => {
    setup();
    const items = all('[role="menuitem"]');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    key(items[2], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    expect(all('[role="separator"]')).toHaveLength(1);
  });

  it('closes, then runs the chosen item', () => {
    const { calls } = setup();
    act(() => all('[role="menuitem"]')[2].click());
    expect(calls).toEqual(['close', 'closeTab']);
  });

  it('closes on Escape and on a press outside, but not on its trigger', () => {
    const { onClose, anchor } = setup();
    act(() => { anchor.current!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    key(window, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ConfirmDialog', () => {
  const labels = () => all('[role="alertdialog"] button').map((b) => b.textContent);

  it('puts the buttons in the platform order and presses the action on Enter', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Save all?" confirmLabel="Save All" onConfirm={onConfirm} onCancel={onCancel}><p>Two files</p></ConfirmDialog>);
    expect(labels()).toEqual(ACTION_BUTTON_FIRST ? ['Save All', 'Cancel'] : ['Cancel', 'Save All']);
    expect(document.activeElement?.textContent).toBe('Save All');
    key(document.activeElement!, 'Enter');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    key(document.activeElement!, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('makes Cancel the default when the action throws something away', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Unsaved changes" confirmLabel="Close Without Saving" destructive onConfirm={onConfirm} onCancel={onCancel}>x</ConfirmDialog>);
    expect(document.activeElement?.textContent).toBe('Cancel');
    key(document.activeElement!, 'Enter');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps keys from the app while open', () => {
    const appShortcut = vi.fn();
    window.addEventListener('keydown', appShortcut);
    render(<ConfirmDialog title="t" confirmLabel="Go" onConfirm={() => {}} onCancel={() => {}}>x</ConfirmDialog>);
    key(document.activeElement!, 's', { ctrlKey: true });
    window.removeEventListener('keydown', appShortcut);
    expect(appShortcut).not.toHaveBeenCalled();
  });
});

describe('Splitter', () => {
  it('hides the panel when dragged below half its minimum, shows it on a click', () => {
    const onWidthChange = vi.fn();
    const onVisibleChange = vi.fn();
    render(<Splitter side="left" width={280} minWidth={200} visible onWidthChange={onWidthChange} onVisibleChange={onVisibleChange} label="file panel" />);
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => { splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 280 })); });
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })); });
    expect(onWidthChange).toHaveBeenLastCalledWith(300);
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 90 })); });
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', {})); });

    onVisibleChange.mockClear();
    render(<Splitter side="left" width={280} minWidth={200} visible={false} onWidthChange={onWidthChange} onVisibleChange={onVisibleChange} label="file panel" />);
    const hidden = document.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => { hidden.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0 })); });
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', {})); });
    act(() => hidden.click());
    expect(onVisibleChange).toHaveBeenCalledWith(true);
  });
});

describe('PaneFrame and EmptyState', () => {
  it('draw the header and the parts that are given', () => {
    render(
      <PaneFrame as="aside" title="Contents" tools={<Button aria-label="Close" />} data-zoom-panel="toc">
        <EmptyState icon={<i />}>No headings found</EmptyState>
      </PaneFrame>
    );
    const pane = document.querySelector('aside.ui-pane')!;
    expect(pane.getAttribute('data-zoom-panel')).toBe('toc');
    expect(pane.querySelector('.ui-pane__title')?.textContent).toBe('Contents');
    expect(pane.querySelector('.ui-pane__tools button')).not.toBeNull();
    expect(pane.querySelector('.ui-empty__text')?.textContent).toBe('No headings found');
    expect(pane.querySelector('.ui-empty__title')).toBeNull();
  });
});
