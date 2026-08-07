import React from 'react';
import { Activity, Database, Radio, Bell } from 'lucide-react';

export default function Header(): JSX.Element {
  return (
    <header className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between bg-[#0b0f19]/80 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 font-display">
            AURORA <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">React TSX</span>
          </h1>
          <p className="text-xs text-slate-400">NASA TESS & Kepler Photometric Analytics Platform</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="hidden md:flex items-center gap-4 text-xs font-medium text-slate-300 bg-slate-900/80 px-4 py-2 rounded-xl border border-white/10">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <span>MinIO Bronze: <strong className="text-white">14.2 GB / 50 GB</strong></span>
          </div>
          <div className="w-px h-4 bg-slate-800" />
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>NATS JetStream: <strong className="text-white">HEALTHY</strong></span>
          </div>
        </div>

        <button className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition">
          <Bell className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
