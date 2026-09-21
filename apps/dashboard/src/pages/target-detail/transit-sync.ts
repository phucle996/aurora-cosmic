import type { TransitSyncEvent } from './components/orbit-viewer/types';

export type TransitSyncListener = (event: TransitSyncEvent) => void;

/**
 * TransitSyncBridge allows high-frequency (10 Hz+) simulation time sync events
 * to travel directly from OrbitViewer3D to SynchronizedLightCurve without triggering
 * re-renders of the root TargetDetailPage or sibling components.
 */
export class TransitSyncBridge {
  private listeners = new Set<TransitSyncListener>();
  private latestEvent: TransitSyncEvent | undefined;

  emit = (event: TransitSyncEvent) => {
    this.latestEvent = event;
    for (const listener of this.listeners) {
      listener(event);
    }
  };

  subscribe = (listener: TransitSyncListener) => {
    this.listeners.add(listener);
    if (this.latestEvent) {
      listener(this.latestEvent);
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  getLatest = (): TransitSyncEvent | undefined => this.latestEvent;
}
