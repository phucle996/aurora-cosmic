import type { JSX } from 'react';
import { Layers, Pause, Play, Ruler, Sparkles, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { PlanetParams } from './types';

export interface SimulationControlsProps {
  isPlaying: boolean;
  speedMultiplier: number;
  showHabitableZone: boolean;
  showTrails: boolean;
  showGrid: boolean;
  showDistanceRuler: boolean;
  planets: PlanetParams[];
  selectedPlanetIndex: number;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onSelectPlanet: (index: number) => void;
  onToggleHabitableZone: () => void;
  onToggleTrails: () => void;
  onToggleGrid: () => void;
  onToggleDistanceRuler: () => void;
}

export function SimulationControls({
  isPlaying,
  speedMultiplier,
  showHabitableZone,
  showTrails,
  showGrid,
  showDistanceRuler,
  planets,
  selectedPlanetIndex,
  onTogglePlay,
  onChangeSpeed,
  onSelectPlanet,
  onToggleHabitableZone,
  onToggleTrails,
  onToggleGrid,
  onToggleDistanceRuler,
}: SimulationControlsProps): JSX.Element {
  return (
    <div className="absolute inset-x-4 bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 border border-border/60 bg-background/90 p-3 px-5 text-xs shadow-none backdrop-blur-xl">
      {/* Play/Pause & Speed Multiplier */}
      <div className="flex items-center gap-4">
        <Button
          variant={isPlaying ? 'secondary' : 'default'}
          size="sm"
          className="h-8 rounded-none px-3 text-xs"
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
            className="h-7 rounded-none px-2.5 font-mono text-xs"
            onClick={() => onSelectPlanet(idx)}
          >
            🪐 {p.name}
          </Button>
        ))}
      </div>

      {/* Layer Toggles: Goldilocks Zone, Trails, AU Grid, Distance Vector */}
      <div className="flex items-center gap-2">
        <Button
          variant={showDistanceRuler ? 'default' : 'outline'}
          size="sm"
          className={`h-7 rounded-none px-2.5 text-xs ${
            showDistanceRuler ? 'bg-sky-600 hover:bg-sky-700 text-white' : ''
          }`}
          onClick={onToggleDistanceRuler}
          title="Toggle astronomical distance vector measurement"
        >
          <Ruler className="size-3.5 mr-1" />
          Distance Ruler
        </Button>

        <Button
          variant={showHabitableZone ? 'default' : 'outline'}
          size="sm"
          className={`h-7 rounded-none px-2.5 text-xs ${
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
          className="h-7 rounded-none px-2.5 text-xs"
          onClick={onToggleTrails}
        >
          <Zap className="size-3.5 mr-1" />
          Trails
        </Button>

        <Button
          variant={showGrid ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 rounded-none px-2.5 text-xs"
          onClick={onToggleGrid}
        >
          <Layers className="size-3.5 mr-1" />
          AU Grid
        </Button>
      </div>
    </div>
  );
}
