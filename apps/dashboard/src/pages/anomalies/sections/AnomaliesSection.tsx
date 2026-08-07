import React from 'react';
import { AlertTriangle, Zap, Radio, LucideIcon } from 'lucide-react';

interface AnomalyItem {
  id: string;
  type: string;
  ticId: string;
  severity: string;
  time: string;
  icon: LucideIcon;
}

export default function AnomaliesSection(): JSX.Element {
  const anomalies: AnomalyItem[] = [
    { id: 'ANO-7821', type: 'SUPER_FLARE', ticId: 'TIC 412084920', severity: 'HIGH', time: '14 mins ago', icon: Zap },
    { id: 'ANO-7819', type: 'ECLIPSING_BINARY', ticId: 'TIC 104928102', severity: 'MEDIUM', time: '2 hours ago', icon: Radio },
    { id: 'ANO-7812', type: 'INSTRUMENT_GLITCH', ticId: 'TIC 892019482', severity: 'LOW', time: '5 hours ago', icon: AlertTriangle },
  ];

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-bold text-white font-display">Unsupervised Detection Events</h3>
      <div className="space-y-3">
        {anomalies.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div key={idx} className="p-4 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm">{item.id}</span>
                    <span className="badge badge-amber">{item.type}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">Target: <strong className="text-indigo-300 font-mono">{item.ticId}</strong> • Detected {item.time}</div>
                </div>
              </div>
              <button className="btn-secondary text-xs">Inspect Event</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
