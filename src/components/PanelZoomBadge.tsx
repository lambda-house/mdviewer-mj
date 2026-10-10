import React from 'react';
import { useStore, type ZoomPanel } from '../store';

/**
 * Shows a side panel's own zoom level (Ctrl + wheel over the panel) while it
 * is not 100%. Clicking it resets the panel to 100%.
 */
const PanelZoomBadge: React.FC<{ panel: ZoomPanel }> = ({ panel }) => {
  const zoom = useStore((s) => s.panelZoom[panel]);
  const zoomPanel = useStore((s) => s.zoomPanel);

  if (zoom === 100) return null;

  return (
    <button
      className="panel-zoom-badge"
      onClick={() => zoomPanel(panel, 0)}
      title="Panel zoom (Ctrl + wheel) - click to reset to 100%"
      type="button"
    >
      {zoom}%
    </button>
  );
};

export default PanelZoomBadge;
