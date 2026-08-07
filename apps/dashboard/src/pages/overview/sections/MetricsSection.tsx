import React from 'react';
import { ArrowUpRight, Database, Sparkles, AlertTriangle } from 'lucide-react';

export default function MetricsSection(): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="glass-card p-5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase">
          <span>Ingested FITS Files</span>
          <Database className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="text-2xl font-bold text-white mt-2">128,490</div>
        <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
          <ArrowUpRight className="w-4 h-4" /> +14.2% from Sector 71
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase">
          <span>Bronze Storage Budget</span>
          <Database className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="text-2xl font-bold text-white mt-2">14.2 / 50.0 GB</div>
        <div className="text-xs text-cyan-400 mt-2">28.4% Capacity (High WM: 90%)</div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase">
          <span>ML Transit Candidates</span>
          <Sparkles className="w-4 h-4 text-purple-400" />
        </div>
        <div className="text-2xl font-bold text-white mt-2">3,421</div>
        <div className="text-xs text-indigo-400 mt-2">1D-CNN Model Accuracy: 96.8%</div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase">
          <span>Detected Anomalies</span>
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
        <div className="text-2xl font-bold text-white mt-2">412</div>
        <div className="text-xs text-amber-400 mt-2">12 Stellar Flares Pending Review</div>
      </div>
    </div>
  );
}
