// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './index';

describe('global agent root in the left column', () => {
  beforeEach(() => {
    useStore.setState({
      agentVisible: true,
      filePanelVisible: true,
      historyVisible: false,
      searchVisible: false,
    });
  });

  it('hides and restores the root without replacing the Files panel', () => {
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState()).toMatchObject({ agentVisible: false, filePanelVisible: true });
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState()).toMatchObject({ agentVisible: true, filePanelVisible: true });
  });

  it('brings the root into view from History', () => {
    useStore.setState({ historyVisible: true, filePanelVisible: false });
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState()).toMatchObject({
      agentVisible: true,
      filePanelVisible: true,
      historyVisible: false,
    });
  });

  it('keeps the root visible when the left column is closed', () => {
    useStore.getState().setFilePanelVisible(false);
    expect(useStore.getState().agentVisible).toBe(true);
  });
});
