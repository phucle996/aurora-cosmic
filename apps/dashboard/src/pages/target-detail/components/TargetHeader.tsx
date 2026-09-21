import type { JSX } from 'react';
import { ArrowLeft, Sparkles, Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Target } from '@/lib/analytics-types';

interface TargetHeaderProps {
  target: Target;
}

export function TargetHeader({ target }: TargetHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3 rounded-none">
          <Link to="/research-factory/discovery">
            <ArrowLeft />
            Target catalog
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight [font-family:'Outfit',sans-serif] md:text-3xl">
            TIC {target.tic_id}
          </h2>
          <Badge variant="secondary" className="rounded-none font-mono text-[10px] uppercase">
            Sector {target.sector}
          </Badge>
          <Badge className="rounded-none font-mono text-[10px] uppercase">
            {target.pipeline_status}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Host-star record, observation coverage and downstream candidate signals.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          className="rounded-none"
          variant="outline"
          onClick={() => document.getElementById('target-system-3d')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <Telescope />
          {target.matched_toi ? `3D · ${target.matched_toi}` : '3D Simulator'}
        </Button>
        {target.has_candidate && (
          <Button asChild className="rounded-none">
            <Link to={`/research-factory/candidates?prediction_id=${encodeURIComponent(target.candidate_prediction_id)}`}>
              <Sparkles />
              Candidate review queue
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
