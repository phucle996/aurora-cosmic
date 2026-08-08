import type { JSX } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface ServiceItem {
  name: string;
  role: string;
  lang: string;
  status: string;
}

export default function TopologySection(): JSX.Element {
  const services: ServiceItem[] = [
    { name: 'go-ingester', role: 'NASA MAST FITS Streaming', lang: 'Go 1.26', status: 'RUNNING' },
    { name: 'rust-preprocessor', role: 'Tokio Signal Preprocessing', lang: 'Rust 1.89', status: 'RUNNING' },
    { name: 'python-ml-worker', role: 'PyTorch Candidate Model', lang: 'Python 3.12', status: 'RUNNING' },
    { name: 'rust-inference', role: 'ONNX Serving Engine', lang: 'Rust 1.89', status: 'RUNNING' },
    { name: 'go-api', role: 'REST Query Gateway', lang: 'Go 1.26', status: 'RUNNING' },
    { name: 'dashboard', role: 'React TSX Router DOM App', lang: 'React 18 / TS', status: 'ACTIVE' },
  ];

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold text-white font-display">Microservice Topology Status</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {services.map((srv, idx) => (
          <div key={idx} className="p-4 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
            <div>
              <div className="font-mono font-medium text-indigo-300 text-sm">{srv.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">{srv.role}</div>
              <div className="text-[11px] text-slate-500 font-mono mt-1">{srv.lang}</div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {srv.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
