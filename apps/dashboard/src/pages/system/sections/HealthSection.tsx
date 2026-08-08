import type { JSX } from 'react';
import { Server, ShieldCheck, Cpu } from 'lucide-react';

export default function HealthSection(): JSX.Element {
  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Server className="w-6 h-6 text-indigo-400" />
        <div>
        <h3 className="text-lg font-semibold text-white font-display">System Infrastructure Health</h3>
          <p className="text-xs text-slate-400">Monitoring Docker Compose Services, MinIO Storage & NATS JetStream</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> MinIO Bronze Watermark Engine
            </span>
            <span className="text-emerald-400 font-mono">28.4% Capacity</span>
          </div>
          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full w-[28.4%]" />
          </div>
          <div className="text-[11px] text-slate-400 flex justify-between">
            <span>Low Watermark: 60%</span>
            <span>High Watermark: 90%</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" /> Tokio & Go Runtime Threads
            </span>
            <span className="text-cyan-400 font-mono">4 Workers Active</span>
          </div>
          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
            <div className="bg-cyan-500 h-full w-[45%]" />
          </div>
          <div className="text-[11px] text-slate-400 flex justify-between">
            <span>CPU Utilization: 45%</span>
            <span>Max Workers: 16</span>
          </div>
        </div>
      </div>
    </div>
  );
}
