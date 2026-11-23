// @vitest-environment happy-dom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, EmptyState, Menu, PaneFrame, Segmented, SplitHandle, Tabs, ACTION_BUTTON_FIRST } from './index';

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

  it('can give the focus to another item first', () => {
    render(<Menu at={{ top: 0, left: 0 }} onClose={() => {}} focusIndex={1} items={[{ label: 'Copy', onSelect: () => {} }, { label: 'Copy as task', onSelect: () => {} }]} />);
    expect(document.activeElement?.textContent).toBe('Copy as task');
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

  it('can make Cancel the default without a destructive action', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Open this link?" confirmLabel="Open link" cancelIsDefault onConfirm={() => {}} onCancel={onCancel}>x</ConfirmDialog>);
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toBe('Cancel');
    expect(focused.className).toContain('ui-btn--primary');
    key(focused, 'Enter');
    expect(onCancel).toHaveBeenCalledTimes(1);
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

describe('SplitHandle', () => {
  it('reports the drag from its start, steps on arrow keys and toggles on Enter and double-click', () => {
    const onDrag = vi.fn(), onStep = vi.fn(), onToggle = vi.fn(), onDragEnd = vi.fn();
    render(<SplitHandle orientation="vertical" onDrag={onDrag} onDragEnd={onDragEnd} onStep={onStep} onToggle={onToggle} label="file panel" />);
    const handle = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    act(() => { handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 280 })); });
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })); });
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 })); });
    expect(onDrag.mock.calls.map((c) => c[0])).toEqual([20, -30]);
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', {})); });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    key(handle, 'ArrowLeft');
    key(handle, 'ArrowRight', { shiftKey: true });
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([-16, 64]);
    key(handle, 'Enter');
    act(() => { handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('next to a collapsed panel, shows it on a click and draws a grip toward it', () => {
    const onToggle = vi.fn();
    render(<SplitHandle orientation="horizontal" collapsed="after" onDrag={() => {}} onToggle={onToggle} label="terminal" />);
    const handle = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(handle.className).toContain('ui-split-handle--collapsed-after');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(handle.querySelector('.ui-split-handle__grip')).not.toBeNull();
    act(() => { handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 0 })); });
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', {})); });
    act(() => handle.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
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
