export type Platform = 'macos' | 'windows' | 'linux';

function detectPlatform(): Platform {
  const name = navigator.platform || navigator.userAgent;
  if (/mac|iphone|ipad/i.test(name)) return 'macos';
  if (/win/i.test(name)) return 'windows';
  return 'linux';
}

/** The system the app runs on, for its conventions (shortcut names, button order). */
export const PLATFORM: Platform = detectPlatform();

/**
 * Where a dialog puts the button that goes ahead. Windows has it first and
 * Cancel last; macOS and Linux (GNOME) have Cancel first and the action last,
 * in the corner.
 */
export const ACTION_BUTTON_FIRST = PLATFORM === 'windows';
