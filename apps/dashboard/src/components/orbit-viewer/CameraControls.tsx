import type { JSX } from 'react';
import { Compass, Crosshair, Maximize2, Minimize2, Rotate3D } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CameraMode } from './types';

export interface CameraControlsProps {
  cameraMode: CameraMode;
  isFullscreen: boolean;
  onResetCamera: () => void;
  onSetTopDownView: () => void;
  onSetTransitView: () => void;
  onToggleFullscreen: () => void;
}

export function CameraControls({
  cameraMode,
  isFullscreen,
  onResetCamera,
  onSetTopDownView,
  onSetTransitView,
  onToggleFullscreen,
}: CameraControlsProps): JSX.Element {
  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-background/85 p-1.5 rounded-xl border border-border/50 backdrop-blur-xl shadow-2xl">
      <Button
        variant={cameraMode === 'free' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        title="Free 3D Orbit Camera"
        onClick={onResetCamera}
      >
        <Rotate3D className="size-3.5 text-primary" />
        3D Orbit
      </Button>
      <Button
        variant={cameraMode === 'polar' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        title="Top-down Polar View"
        onClick={onSetTopDownView}
      >
        <Compass className="size-3.5 text-sky-400" />
        Polar
      </Button>
      <Button
        variant={cameraMode === 'transit' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        title="Side-on Transit Eclipse View"
        onClick={onSetTransitView}
      >
        <Crosshair className="size-3.5 text-rose-400" />
        Transit Eclipse
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-8"
        title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen / Theater Mode'}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </Button>
    </div>
  );
}
