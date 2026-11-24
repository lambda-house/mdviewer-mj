import { useState, type ChangeEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from '@lambda-house/ui';
import { useReader, useReaderContext } from './host';
import { MAX_ZOOM, MIN_ZOOM, focusedGroupOf } from './store';

// The slider is logarithmic: 50%..1600% is 5 doublings, so a linear slider
// would squeeze everything below 200% into the first few pixels.
const SLIDER_STEPS = 1000;
const zoomToSlider = (zoom: number) =>
  Math.round((Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * SLIDER_STEPS);
const sliderToZoom = (value: number) =>
  MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / SLIDER_STEPS);

/**
 * The toolbar's zoom of the focused document group: its percentage, opening
 * on hover into reset, out, a slider and in.
 */
export function DocumentZoom() {
  const { store } = useReaderContext();
  const zoom = useReader((s) => focusedGroupOf(s).zoom);
  const [expanded, setExpanded] = useState(false);
  const zoomOut = () => store.getState().zoomOut();
  const zoomIn = () => store.getState().zoomIn();

  return (
    <div
      className={cx('zoom-control', expanded ? 'expanded' : 'collapsed')}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onClick={() => !expanded && setExpanded(true)}
    >
      {expanded ? (
        <>
          <button
            className={cx('zoom-reset-button', zoom === 100 && 'disabled')}
            onClick={zoom !== 100 ? () => store.getState().resetZoom() : undefined}
            title="Reset to 100%"
          >
            100%
          </button>
          <button className="zoom-button" onClick={zoomOut} title={`Zoom out (${zoom}%)`}>
            <Minus size={12} />
          </button>
          <input
            type="range"
            className="zoom-slider"
            min="0"
            max={SLIDER_STEPS}
            step="1"
            value={zoomToSlider(zoom)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => store.getState().setZoom(sliderToZoom(parseInt(e.target.value, 10)))}
            title={`${zoom}%`}
          />
          <button className="zoom-button" onClick={zoomIn} title={`Zoom in (${zoom}%)`}>
            <Plus size={12} />
          </button>
          <span className="zoom-value">{zoom}%</span>
        </>
      ) : (
        <span className="zoom-value">{zoom}%</span>
      )}
    </div>
  );
}
