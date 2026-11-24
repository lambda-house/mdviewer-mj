import type { CSSProperties } from 'react';

/*
 * The window's top bar as its title bar (Agent MCR's MCR-138, MCR-145). On
 * macOS a window with an overlay title bar has no title row of its own: the
 * traffic lights are drawn over the start of the app's top bar. The bar then
 * leaves room for the lights, and its empty space moves the window and zooms
 * it on a double-click, as a title bar does. The app knows which window it is
 * and whether it is in full screen (that is Tauri); the Shell gets the answer
 * as its `titleBar`.
 *
 * Where the lights land (measured on macOS 27.2 with tao 0.37.1, which places
 * them for trafficLightPosition {x, y}): each light is 14 px square, one every
 * 23 px from x, so the third ends at x + 60; tao makes the title bar 14 + y
 * tall and AppKit keeps the lights 9 px above its bottom, so their centre is at
 * y - 2 from the window's top. A tauri.macos.conf.json with x 14 and y 21 puts
 * the centre at 19, the centre of a bar of --titlebar-height (39 px less its
 * 1 px border).
 */

/**
 * `native`: the system draws the title bar, the top bar is an ordinary row.
 * `overlay`: the traffic lights are over the top bar. `fullscreen`: an overlay
 * window in full screen, where macOS hides the lights, so the bar needs no
 * room for them and cannot move the window.
 */
export type TitleBar = 'native' | 'overlay' | 'fullscreen';

/** The lights' left edge in the window, trafficLightPosition.x. */
export const TRAFFIC_LIGHT_X = 14;
/** From the first light's left edge to the third's right edge. */
export const TRAFFIC_LIGHTS_WIDTH = 3 * 14 + 2 * 9;
/** Room at the start of the top bar for the lights: the gap after the third is the window's margin before the first. */
export const TRAFFIC_LIGHT_INSET = TRAFFIC_LIGHT_X + TRAFFIC_LIGHTS_WIDTH + TRAFFIC_LIGHT_X;

/** Left inset of the top bar, in CSS pixels. */
export function topRowInset(bar: TitleBar): number {
  return bar === 'overlay' ? TRAFFIC_LIGHT_INSET : 0;
}

export interface TopRowProps {
  'data-titlebar'?: TitleBar;
  /**
   * Tauri's drag script (tauri 2.12, `window/scripts/drag.js`): `deep` makes a
   * press anywhere in the row drag the window and a double-click zoom it,
   * except on what can be clicked (buttons, inputs, links, `role="tab"` and the
   * like) and below an element marked `false` (`NO_DRAG`).
   */
  'data-tauri-drag-region'?: 'deep';
  style?: CSSProperties;
}

/**
 * The attributes of the top bar. Nothing for a native title bar, so Windows
 * and Linux get the bar they had. No drag region in full screen, where the
 * window cannot be moved and a double-click must not unzoom it.
 */
export function topRowProps(bar: TitleBar): TopRowProps {
  if (bar === 'native') return {};
  if (bar === 'fullscreen') return { 'data-titlebar': bar };
  return { 'data-titlebar': bar, 'data-tauri-drag-region': 'deep', style: { paddingLeft: topRowInset(bar) } };
}

/**
 * For a part of a drag region that reacts to the pointer without being a
 * button (a menu's frame, a popover, a hover control): a press there is not a
 * drag. Without a drag region above it, the attribute does nothing. The Shell
 * puts it on everything that goes into its bar, so its own empty space is all
 * that drags.
 */
export const NO_DRAG = { 'data-tauri-drag-region': 'false' } as const;
