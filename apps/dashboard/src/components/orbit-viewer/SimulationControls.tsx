import type { JSX } from 'react';
import { Layers, Pause, Play, Sparkles, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { PlanetParams } from './types';

export interface SimulationControlsProps {
  isPlaying: boolean;
  speedMultiplier: number;
  showHabitableZone: boolean;
  showTrails: boolean;
  showGrid: boolean;
  planets: PlanetParams[];
  selectedPlanetIndex: number;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onSelectPlanet: (index: number) => void;
  onToggleHabitableZone: () => void;
  onToggleTrails: () => void;
  onToggleGrid: () => void;
}

export function SimulationControls({
  isPlaying,
  speedMultiplier,
  showHabitableZone,
  showTrails,
  showGrid,
  planets,
  selectedPlanetIndex,
  onTogglePlay,
  onChangeSpeed,
  onSelectPlanet,
  onToggleHabitableZone,
  onToggleTrails,
  onToggleGrid,
}: SimulationControlsProps): JSX.Element {
  return (
    <div className="absolute bottom-4 inset-x-4 z-10 flex flex-wrap items-center justify-between gap-3 bg-background/90 p-3 px-5 rounded-2xl border border-border/60 backdrop-blur-xl shadow-2xl text-xs">
      {/* Play/Pause & Speed Multiplier */}
      <div className="flex items-center gap-4">
        <Button
          variant={isPlaying ? 'secondary' : 'default'}
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={onTogglePlay}
        >
          {isPlaying ? <Pause className="size-3.5 mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
          {isPlaying ? 'Pause' : 'Resume'}
        </Button>

        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground font-mono text-xs w-12 text-right">
            {speedMultiplier}x speed
          </span>
          <Slider
            value={[speedMultiplier]}
            min={1}
            max={60}
            step={1}
            onValueChange={(val) => onChangeSpeed(val[0] ?? 8)}
            className="w-24"
          />
        </div>
      </div>

      {/* Planet Switcher Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {planets.map((p, idx) => (
          <Button
            key={p.name}
            variant={idx === selectedPlanetIndex ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs font-mono"
            onClick={() => onSelectPlanet(idx)}
          >
            🪐 {p.name}
          </Button>
        ))}
      </div>

      {/* Layer Toggles: Goldilocks Zone, Trails, AU Grid */}
      <div className="flex items-center gap-2">
        <Button
          variant={showHabitableZone ? 'default' : 'outline'}
          size="sm"
          className={`h-7 px-2.5 text-xs ${
            showHabitableZone ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
          }`}
          onClick={onToggleHabitableZone}
        >
          <Sparkles className="size-3.5 mr-1" />
          Goldilocks Zone
        </Button>

        <Button
          variant={showTrails ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={onToggleTrails}
        >
          <Zap className="size-3.5 mr-1" />
          Trails
        </Button>

        <Button
          variant={showGrid ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={onToggleGrid}
        >
          <Layers className="size-3.5 mr-1" />
          AU Grid
        </Button>
      </div>
    </div>
  );
}
