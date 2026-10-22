import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, DetachedRouteHandle, destroyDetachedRouteHandle } from '@angular/router';

/** keepAlive name of the live map route. */
export const LIVE_MAP_KEEP_ALIVE = 'live-map';

/**
 * Keeps routes marked `data: { keepAlive: '<name>' }` alive while the user moves to sibling
 * routes, instead of destroying and recreating them. Used for the live map: a new map reloads its
 * style and tiles and loses its view, so the player keeps one map for the whole game.
 *
 * One handle per name, scoped to the :eventId in the URL. The owner (LiveShell) calls
 * `release()` when it is destroyed so the kept component does not outlive its injector.
 */
@Injectable({ providedIn: 'root' })
export class KeepAliveRouteStrategy extends BaseRouteReuseStrategy {
  private readonly kept = new Map<string, { scope: string; handle: DetachedRouteHandle }>();

  private static nameOf(route: ActivatedRouteSnapshot): string | null {
    const name: unknown = route.routeConfig?.data?.['keepAlive'];
    return typeof name === 'string' ? name : null;
  }

  private static scopeOf(route: ActivatedRouteSnapshot): string {
    return route.pathFromRoot.map((r) => r.params['eventId']).find(Boolean) ?? '';
  }

  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return KeepAliveRouteStrategy.nameOf(route) !== null;
  }

  override store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const name = KeepAliveRouteStrategy.nameOf(route);
    if (!name) return;
    const prev = this.kept.get(name);
    if (!handle) {
      this.kept.delete(name);
      return;
    }
    if (prev && prev.handle !== handle) destroyDetachedRouteHandle(prev.handle);
    this.kept.set(name, { scope: KeepAliveRouteStrategy.scopeOf(route), handle });
  }

  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return this.retrieve(route) !== null;
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const name = KeepAliveRouteStrategy.nameOf(route);
    const entry = name ? this.kept.get(name) : undefined;
    return entry && entry.scope === KeepAliveRouteStrategy.scopeOf(route) ? entry.handle : null;
  }

  /** Destroy a kept component (e.g. when the screen that owns it closes). */
  release(name: string): void {
    const entry = this.kept.get(name);
    if (!entry) return;
    this.kept.delete(name);
    destroyDetachedRouteHandle(entry.handle);
  }
}
