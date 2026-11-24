import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Shell, type ShellProps } from './Shell';
import { MainMenu } from './MainMenu';
import { SettingsDialog, appearanceTab, shortcutsTab, type SettingsTab } from './settings';
import { commandForKey, matchesShortcut, menuCommands, type MenuItem } from './commands';
import { usePlugins, type PluginRegistry } from './plugins';
import type { PaneType } from './LayoutView';

// The window an app assembles from plugins (shared UI spec §3.3, §5.7): the
// shell with the surfaces plugins bring, the main menu, the one Settings
// dialog with their tabs, their overlays, all inside their wrappers. The
// menu's shortcuts work in the whole window, and the native menu runs its
// commands by id. The app keeps what its commands read: the shown surface,
// whether Settings is open, the theme.

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
  /** The main menu button's class, to match the toolbar beside it. */
  menuButtonClassName?: string;
  /** The native menu's events: `run` gets a command's id. Returns how to stop listening. */
  nativeMenu?: (run: (commandId: string) => void) => Promise<() => void>;
  /** At the right end of the top bar, on every surface: settings, theme. */
  end?: ReactNode;
  status?: ShellProps['status'];
  settings: { open: boolean; onClose: () => void };
  /** The Appearance tab's theme; without it there is no such tab. */
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
  registry, surface, onSurface, menu, commandContext, useCommandContext, onMenuOpen, menuButtonClassName,
  nativeMenu, end, status, settings, appearance, className,
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
    <div className={className}>
      <Shell
        surfaces={registry.items('workbench:surface')}
        active={surface}
        onActivate={onSurface}
        status={status}
        menu={<MainMenu items={menu} useCommandContext={useCommandContext} onOpen={onMenuOpen} buttonClassName={menuButtonClassName} surface={surface} />}
        end={end}
      />
      <SettingsDialog open={settings.open} onClose={settings.onClose} tabs={tabs} />
      {registry.items('workbench:overlay').map((overlay) => <Fragment key={overlay.id}>{overlay.render()}</Fragment>)}
    </div>
  );
  // The first wrapper is the outermost
  const wrappers = registry.items('workbench:wrapper');
  for (let i = wrappers.length - 1; i >= 0; i--) window = wrappers[i].wrap(window);
  return <>{window}</>;
}
