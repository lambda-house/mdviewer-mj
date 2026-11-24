import { useSyncExternalStore, type ReactNode } from 'react';
import type { PaneType } from './LayoutView';
import type { PaletteProvider } from './Palette';
import type { SettingsTab } from './settings';
import type { ShellSurface, ShellView } from './Shell';

// The plugin registry (shared UI spec §5.7). The workbench names no extension
// point of its own: an app declares the ones it has by declaration merging,
//
//   declare module '@lambda-house/workbench' {
//     interface WorkbenchPoints { 'live:pane-type': LivePaneType }
//     interface WorkbenchSlots { 'live:pane-tools': (ctx: PaneToolsContext) => ReactNode }
//     interface WorkbenchEvents { 'session:started': { id: string } }
//   }
//
// and its plugins contribute items to points, override slots and send events.
// The workbench's own points are the `workbench:*` ones below: what the
// Workbench component draws (shared UI spec §5.7).

/** A surface of the window, in the top bar's switch by `order` (lower first, 100 by default). */
export interface WorkbenchSurface extends ShellSurface { order?: number }
/** A view of a surface, in its view switch by `order` (lower first, 100 by default); the surface draws them (useViews, ShellViews). */
export interface WorkbenchView extends ShellView { surface: string; order?: number }
/** A pane type a view's layout can show (usePaneTypes). */
export interface WorkbenchPaneType { view: string; type: PaneType }
/** Drawn once beside the shell: a dialog, an overlay, or a component that only runs effects. */
export interface WorkbenchOverlay { id: string; order?: number; render: () => ReactNode }
/** Wraps the whole window: a context provider. The first by `order` is the outermost. */
export interface WorkbenchWrapper { id: string; order?: number; wrap: (children: ReactNode) => ReactNode }

/** Extension points: name → the type of what plugins contribute there. */
export interface WorkbenchPoints {
  'workbench:surface': WorkbenchSurface;
  'workbench:view': WorkbenchView;
  'workbench:pane-type': WorkbenchPaneType;
  'workbench:palette-provider': PaletteProvider;
  'workbench:settings-tab': SettingsTab;
  'workbench:overlay': WorkbenchOverlay;
  'workbench:wrapper': WorkbenchWrapper;
}
/** Override slots: name → the render function a plugin may put in. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkbenchSlots {}
/** Events: name → payload. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkbenchEvents {}

type Point = keyof WorkbenchPoints;
type Slot = keyof WorkbenchSlots;
type EventName = keyof WorkbenchEvents;

export interface PluginApi {
  /** Add an item to an extension point; it goes when the plugin is disabled. */
  contribute: <K extends Point>(point: K, item: WorkbenchPoints[K]) => void;
  /** Put a render function in a slot (the last enabled plugin's wins). */
  overrideSlot: <K extends Slot>(slot: K, render: WorkbenchSlots[K]) => void;
  onEvent: <E extends EventName>(event: E, handler: (payload: WorkbenchEvents[E]) => void) => () => void;
  emitEvent: <E extends EventName>(event: E, payload: WorkbenchEvents[E]) => void;
}

export interface Plugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Off until the person turns it on. */
  defaultDisabled?: boolean;
  /** Part of the app (the reader, the journal): always on, and not among the plugins to switch. */
  required?: boolean;
  /** Registers what the plugin brings; may return a cleanup. */
  setup: (api: PluginApi) => void | (() => void);
}

/** Where the registry keeps which plugins are on and off (localStorage, or nothing). */
export interface PluginStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface Entry { plugin: Plugin; active: boolean; cleanup: Array<() => void> }

/** An item's place in its point: lower first, 100 by default. */
const orderOf = (item: unknown) => (item as { order?: number } | null)?.order ?? 100;

export class PluginRegistry {
  private plugins = new Map<string, Entry>();
  private points = new Map<string, Array<{ pluginId: string; item: unknown }>>();
  private slots = new Map<string, Array<{ pluginId: string; render: unknown }>>();
  private listeners = new Map<string, Set<(payload: never) => void>>();
  private subscribers = new Set<() => void>();
  private disabled: Set<string>;
  private explicitlyEnabled: Set<string>;
  private revision = 0;

  /** `namespace` names the storage keys: `${namespace}:disabled-plugins`, `${namespace}:enabled-plugins`. */
  constructor(private storage: PluginStorage | null = null, private namespace = 'workbench') {
    this.disabled = this.load('disabled-plugins');
    this.explicitlyEnabled = this.load('enabled-plugins');
  }

  private load(name: string): Set<string> {
    try {
      const parsed = JSON.parse(this.storage?.getItem(`${this.namespace}:${name}`) ?? '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private save(name: string, ids: Set<string>): void {
    try { this.storage?.setItem(`${this.namespace}:${name}`, JSON.stringify([...ids])); } catch { /* not kept */ }
  }

  /** Re-render subscribers: the revision changes with every registration. */
  subscribe = (fn: () => void): (() => void) => {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  };

  getRevision = (): number => this.revision;

  private notify(): void {
    this.revision++;
    this.subscribers.forEach((fn) => fn());
  }

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) this.unregister(plugin.id);
    const entry: Entry = { plugin, active: false, cleanup: [] };
    this.plugins.set(plugin.id, entry);
    if (plugin.required) this.disabled.delete(plugin.id);
    else if (plugin.defaultDisabled && !this.explicitlyEnabled.has(plugin.id)) this.disabled.add(plugin.id);
    if (!this.disabled.has(plugin.id)) this.activate(entry);
    this.notify();
  }

  unregister(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;
    this.deactivate(entry);
    this.plugins.delete(pluginId);
    this.notify();
  }

  isEnabled(pluginId: string): boolean {
    return !this.disabled.has(pluginId);
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const entry = this.plugins.get(pluginId);
    if (!enabled && entry?.plugin.required) return;
    if (enabled) {
      this.disabled.delete(pluginId);
      this.explicitlyEnabled.add(pluginId);
      if (entry && !entry.active) this.activate(entry);
    } else {
      this.disabled.add(pluginId);
      this.explicitlyEnabled.delete(pluginId);
      if (entry) this.deactivate(entry);
    }
    this.save('disabled-plugins', this.disabled);
    this.save('enabled-plugins', this.explicitlyEnabled);
    this.notify();
  }

  listPlugins(): Array<Plugin & { enabled: boolean }> {
    return [...this.plugins.values()].map(({ plugin }) => ({ ...plugin, enabled: !this.disabled.has(plugin.id) }));
  }

  /** What enabled plugins contributed to a point, by `order` (then registration). */
  items<K extends Point>(point: K): Array<WorkbenchPoints[K]> {
    return [...(this.points.get(point as string) ?? [])]
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => orderOf(a.item) - orderOf(b.item) || a.index - b.index)
      .map((entry) => entry.item as WorkbenchPoints[K]);
  }

  /** The render function an enabled plugin put in a slot (the last one registered). */
  slot<K extends Slot>(slot: K): WorkbenchSlots[K] | undefined {
    const renders = this.slots.get(slot as string);
    return renders?.[renders.length - 1]?.render as WorkbenchSlots[K] | undefined;
  }

  onEvent<E extends EventName>(event: E, handler: (payload: WorkbenchEvents[E]) => void): () => void {
    let set = this.listeners.get(event as string);
    if (!set) this.listeners.set(event as string, (set = new Set()));
    const fn = handler as (payload: never) => void;
    set.add(fn);
    return () => { set?.delete(fn); };
  }

  emitEvent<E extends EventName>(event: E, payload: WorkbenchEvents[E]): void {
    for (const handler of this.listeners.get(event as string) ?? []) {
      try {
        (handler as (p: WorkbenchEvents[E]) => void)(payload);
      } catch (error) {
        console.error(`[plugin-event:${String(event)}]`, error);
      }
    }
  }

  private activate(entry: Entry): void {
    entry.active = true;
    const pluginId = entry.plugin.id;
    const api: PluginApi = {
      contribute: (point, item) => {
        const list = this.points.get(point as string) ?? [];
        const record = { pluginId, item: item as unknown };
        this.points.set(point as string, [...list, record]);
        entry.cleanup.push(() => {
          this.points.set(point as string, (this.points.get(point as string) ?? []).filter((r) => r !== record));
        });
      },
      overrideSlot: (slot, render) => {
        const record = { pluginId, render: render as unknown };
        this.slots.set(slot as string, [...(this.slots.get(slot as string) ?? []), record]);
        entry.cleanup.push(() => {
          this.slots.set(slot as string, (this.slots.get(slot as string) ?? []).filter((r) => r !== record));
        });
      },
      onEvent: (event, handler) => {
        const off = this.onEvent(event, handler);
        entry.cleanup.push(off);
        return off;
      },
      emitEvent: (event, payload) => this.emitEvent(event, payload),
    };
    try {
      const cleanup = entry.plugin.setup(api);
      if (typeof cleanup === 'function') entry.cleanup.push(cleanup);
    } catch (error) {
      // A plugin that fails to start takes back what it registered; the others still load
      console.error(`[plugin:${pluginId}] setup failed`, error);
      this.deactivate(entry);
    }
  }

  private deactivate(entry: Entry): void {
    entry.active = false;
    while (entry.cleanup.length > 0) {
      try { entry.cleanup.pop()?.(); } catch { /* ignore */ }
    }
  }
}

export function createPlugin(plugin: Plugin): Plugin {
  return plugin;
}

/** Re-renders when plugins register, go or change what they contribute. */
export function usePlugins(registry: PluginRegistry): number {
  return useSyncExternalStore(registry.subscribe, registry.getRevision);
}
