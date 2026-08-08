import type { JSX } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface CandidateItem {
  ticId: string;
  period: string;
  depth: string;
  radius: string;
  confidence: string;
  label: string;
}

export default function CandidatesSection(): JSX.Element {
  const candidates: CandidateItem[] = [
    { ticId: 'TOI-4521.01', period: '3.42 days', depth: '1,240 ppm', radius: '1.45 R_Earth', confidence: '98.4%', label: 'CONFIRMED PLANET' },
    { ticId: 'TOI-3891.01', period: '12.81 days', depth: '850 ppm', radius: '2.10 R_Earth', confidence: '94.1%', label: 'CANDIDATE' },
    { ticId: 'TOI-2104.01', period: '0.89 days', depth: '4,100 ppm', radius: '11.2 R_Earth', confidence: '89.7%', label: 'HOT JUPITER' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {candidates.map((item, idx) => (
          <div key={idx} className="glass-card p-6 space-y-4 border-indigo-500/20">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-lg text-white">{item.ticId}</span>
              <span className="badge badge-purple">{item.label}</span>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span className="text-slate-400">Orbital Period:</span>
                <span className="font-mono text-white">{item.period}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span className="text-slate-400">Transit Depth:</span>
                <span className="font-mono text-white">{item.depth}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span className="text-slate-400">Estimated Radius:</span>
                <span className="font-mono text-white">{item.radius}</span>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-slate-400">ML Model Score:</span>
                <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {item.confidence}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
