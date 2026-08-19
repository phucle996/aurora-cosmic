import type { JSX } from 'react';
import {
  Compass,
  Crosshair,
  Maximize2,
  Minimize2,
  Rotate3D,
  Target,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CameraMode } from './types';

export interface CameraControlsProps {
  cameraMode: CameraMode;
  isFullscreen: boolean;
  zoomLevel: number;
  hasPlanets: boolean;
  onResetCamera: () => void;
  onFocusPlanet: () => void;
  onSetTopDownView: () => void;
  onSetTransitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFullscreen: () => void;
}

export function CameraControls({
  cameraMode,
  isFullscreen,
  zoomLevel,
  hasPlanets,
  onResetCamera,
  onFocusPlanet,
  onSetTopDownView,
  onSetTransitView,
  onZoomIn,
  onZoomOut,
  onToggleFullscreen,
}: CameraControlsProps): JSX.Element {
  return (
    <div className="absolute top-4 right-4 z-10 flex flex-wrap items-center gap-1.5 bg-background/90 p-1.5 rounded-xl border border-border/60 backdrop-blur-xl shadow-2xl">
      {/* Zoom In/Out Buttons & Indicator */}
      <div className="flex items-center gap-1 bg-muted/30 px-1.5 py-0.5 rounded-lg border border-border/40">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title="Zoom In (Close-up)"
          onClick={onZoomIn}
        >
          <ZoomIn className="size-3.5" />
        </Button>

        <span className="font-mono text-[11px] text-muted-foreground w-11 text-center font-medium">
          {Math.round(zoomLevel * 100)}%
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title="Zoom Out (Wide View)"
          onClick={onZoomOut}
        >
          <ZoomOut className="size-3.5" />
        </Button>
      </div>

      <div className="h-4 w-px bg-border/60 mx-0.5" />

      {/* Focus Planet Button */}
      {hasPlanets && (
        <Button
          variant={cameraMode === 'focus_planet' ? 'default' : 'outline'}
          size="sm"
          className={`h-8 text-xs gap-1.5 ${
            cameraMode === 'focus_planet'
              ? 'bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-500/25'
              : 'border-sky-500/40 text-sky-400'
          }`}
          title="Close-Up Planet Inspection"
          onClick={onFocusPlanet}
        >
          <Target className="size-3.5" />
          Focus Planet
        </Button>
      )}

      {/* 3D Orbit Free Cam */}
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

      {/* Top-Down Polar View */}
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

      {/* Transit Eclipse View */}
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

      {/* Fullscreen / Theater Mode */}
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
