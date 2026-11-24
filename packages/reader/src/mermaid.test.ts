// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mermaid itself is not what is tested: it draws a 400 × 300 diagram
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 400 300" width="400" height="300"><g></g></svg>' })),
  },
}));

import { MERMAID_REFIT_MIN_CHANGE, renderMermaid } from './markdown';

// happy-dom has no layout: the container's width is set here, and the resize
// observer is one the test calls when it says the width changed
const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  disconnected = false;
  constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
  fire() { this.callback([], this as unknown as ResizeObserver); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
  document.body.innerHTML = '';
});

describe('a Mermaid diagram', () => {
  it('fits its width, and fits again when the width changes', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const doc = document.createElement('div');
    doc.innerHTML = '<div class="mermaid-container" data-mermaid="graph TD; A-->B"></div>';
    document.body.appendChild(doc);
    const container = doc.querySelector<HTMLElement>('.mermaid-container')!;
    let width = 800;
    Object.defineProperty(container, 'clientWidth', { get: () => width, configurable: true });

    await renderMermaid(doc, 'dark');
    const content = container.querySelector<HTMLElement>('.mermaid-content')!;
    const viewport = container.querySelector<HTMLElement>('.mermaid-viewport')!;
    const sizes = () => [content.style.width, content.style.height, viewport.style.height];
    // 800 wide: the diagram at its own size, in a viewport as tall as it would be at the full width (at most 600)
    expect(sizes()).toEqual(['400px', '300px', '600px']);

    // The editor opens beside it: 300 wide, the diagram scaled down to fit
    width = 300;
    observers[0].fire();
    expect(sizes()).toEqual(['300px', '225px', '225px']);

    // A scrollbar's worth narrower, or hidden: no new fit
    width = 300 - (MERMAID_REFIT_MIN_CHANGE - 1);
    observers[0].fire();
    width = 0;
    observers[0].fire();
    expect(sizes()).toEqual(['300px', '225px', '225px']);

    // Expanded to the full height, it follows the width too
    container.querySelector<HTMLButtonElement>('.mermaid-expand')!.click();
    expect(sizes()).toEqual(['300px', '225px', '225px']);
    width = 640;
    observers[0].fire();
    expect(sizes()).toEqual(['640px', '480px', '480px']);
    container.querySelector<HTMLButtonElement>('.mermaid-expand')!.click();
    expect(sizes()).toEqual(['400px', '300px', '480px']);

    // Out of the document: it stops watching
    doc.remove();
    observers[0].fire();
    expect(observers[0].disconnected).toBe(true);
  });
});
