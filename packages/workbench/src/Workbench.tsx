import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Moon, Search, Settings, Sun } from 'lucide-react';
import { cx } from '@lambda-house/ui';
import { Shell, type ShellProps } from './Shell';
import { MainMenu } from './MainMenu';
import { SettingsDialog, appearanceTab, shortcutsTab, type SettingsTab } from './settings';
import { commandForKey, commandTitle, matchesShortcut, menuCommands, type MenuItem } from './commands';
import { WINDOW_COMMANDS } from './windowCommands';
import { usePlugins, type PluginRegistry } from './plugins';
import type { PaneType } from './LayoutView';

// The window an app assembles from plugins (shared UI spec §3.3, §5.7): the
// shell with the surfaces plugins bring, the main menu, the palette, settings
// and theme buttons at the end of the bar, the one Settings dialog with their
// tabs, their overlays, all inside their wrappers. The menu's shortcuts work
// in the whole window, and the native menu runs its commands by id. The app
// keeps what its commands read: the shown surface, whether Settings is open,
// the theme.

export interface WorkbenchProps<C> {
  registry: PluginRegistry;
  /** The shown surface; the app keeps it (its commands read it). */
  surface: string;
  onSurface: (surface: string) => void;
  /** The main menu: the app's commands, grouped. Their keys run them on the shown surface. */
  menu: MenuItem<C>[];
  /** What the commands' `enabled` and `checked` read now (the native menu)… */
  commandContext: () => C;
  /** …and as a hook, re-rendering on changes (the main menu while it is open). */
  useCommandContext: () => C;
  /** Before the main menu opens (the editor passes on its pending typing). */
  onMenuOpen?: () => void;
  /** The native menu's events: `run` gets a command's id. Returns how to stop listening. */
  nativeMenu?: (run: (commandId: string) => void) => Promise<() => void>;
  status?: ShellProps['status'];
  /** The palette: the ⌕ at the end of the bar opens it, disabled while `enabled` is false. Without it there is no ⌕. */
  palette?: { open: () => void; enabled?: boolean };
  /** The Settings dialog: the ⚙ at the end of the bar opens it. */
  settings: { open: boolean; onOpenChange: (open: boolean) => void };
  /** The theme: the Appearance tab and the ☾/☀ at the end of the bar. Without it, neither. */
  appearance?: Parameters<typeof appearanceTab>[0];
  className?: string;
}

/** A view's pane types: what plugins contributed for it, by type. */
export function usePaneTypes(registry: PluginRegistry, view: string): Record<string, PaneType> {
  const revision = usePlugins(registry);
  return useMemo(
    () => Object.fromEntries(registry.items('workbench:pane-type').filter((p) => p.view === view).map((p) => [p.type.type, p.type])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, view, revision],
  );
}

/** The menu's shortcuts in the whole window: a key runs its command on the shown surface. */
function useCommandKeys<C>(menu: MenuItem<C>[], surface: string): void {
  const shown = useRef(surface);
  shown.current = surface;
  useEffect(() => {
    const commands = menuCommands(menu);
    const onKeyDown = (e: KeyboardEvent) => {
      // Already handled: the editor's own keys (its find, Ctrl+S, Alt+arrows)
      if (e.defaultPrevented) return;
      const command = commandForKey(commands, e, shown.current);
      if (command) {
        e.preventDefault();
        command.run();
        return;
      }
      // A command's key on another surface does nothing, rather than the browser's own (print, close)
      if (commands.some((c) => [c.shortcut, ...(c.aliases ?? [])].some((shortcut) => shortcut && matchesShortcut(e, shortcut)))) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menu]);
}

/**
 * At the right end of the bar, on every surface (spec §5.1): the palette,
 * Settings, the theme. Their tooltips are the menu's commands (with their keys).
 */
function WindowTools<C>({ menu, palette, settings, appearance }: Pick<WorkbenchProps<C>, 'menu' | 'palette' | 'settings' | 'appearance'>) {
  const commands = menuCommands(menu);
  const title = (id: string, fallback: string) => {
    const command = commands.find((c) => c.id === id);
    return command ? commandTitle(command) : fallback;
  };
  const theme = appearance?.theme;
  return (
    <div className="wb-tool-group">
      {palette && (
        <button type="button" className="wb-tool" onClick={palette.open} disabled={palette.enabled === false} title={title(WINDOW_COMMANDS.palette, 'Command Palette')}>
          <Search size={16} />
        </button>
      )}
      <button type="button" className="wb-tool" onClick={() => settings.onOpenChange(true)} title={title(WINDOW_COMMANDS.settings, 'Settings')}>
        <Settings size={16} />
      </button>
      {appearance && (
        <button
          type="button"
          className="wb-tool"
          onClick={() => appearance.setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
    </div>
  );
}

/** The native menu runs the menu's commands by id, when they are enabled. */
function useNativeMenu<C>(menu: MenuItem<C>[], context: () => C, nativeMenu: WorkbenchProps<C>['nativeMenu']): void {
  const read = useRef(context);
  read.current = context;
  useEffect(() => {
    if (!nativeMenu) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    nativeMenu((id) => {
      const command = menuCommands(menu).find((item) => item.id === id);
      if (command && (!command.enabled || command.enabled(read.current()))) command.run();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch((error) => console.error('Failed to listen for menu commands:', error));
    return () => { disposed = true; stop?.(); };
  }, [menu, nativeMenu]);
}

export function Workbench<C>({
  registry, surface, onSurface, menu, commandContext, useCommandContext, onMenuOpen,
  nativeMenu, status, palette, settings, appearance, className,
}: WorkbenchProps<C>) {
  usePlugins(registry);
  useCommandKeys(menu, surface);
  useNativeMenu(menu, commandContext, nativeMenu);

  const current = useRef(menu);
  current.current = menu;
  const tabs: SettingsTab[] = [
    ...(appearance ? [appearanceTab(appearance)] : []),
    shortcutsTab(() => current.current),
    ...registry.items('workbench:settings-tab'),
  ];

  let window: ReactNode = (
    <div className={cx('wb-window', className)}>
      <Shell
        surfaces={registry.items('workbench:surface')}
        active={surface}
        onActivate={onSurface}
        status={status}
        menu={<MainMenu items={menu} useCommandContext={useCommandContext} onOpen={onMenuOpen} surface={surface} />}
        end={<WindowTools menu={menu} palette={palette} settings={settings} appearance={appearance} />}
      />
      <SettingsDialog open={settings.open} onClose={() => settings.onOpenChange(false)} tabs={tabs} />
      {registry.items('workbench:overlay').map((overlay) => <Fragment key={overlay.id}>{overlay.render()}</Fragment>)}
    </div>
  );
  // The first wrapper is the outermost
  const wrappers = registry.items('workbench:wrapper');
  for (let i = wrappers.length - 1; i >= 0; i--) window = wrappers[i].wrap(window);
  return <>{window}</>;
}
