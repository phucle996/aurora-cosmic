import type { JSX } from 'react';
import { Search, Filter } from 'lucide-react';

interface TargetRow {
  ticId: string;
  sector: string;
  ra: string;
  dec: string;
  mag: string;
  status: string;
}

export default function TargetsTableSection(): JSX.Element {
  const targets: TargetRow[] = [
    { ticId: 'TIC 261136674', sector: 'Sector 72', ra: '124.542°', dec: '+48.215°', mag: '11.4', status: 'INGESTED' },
    { ticId: 'TIC 147539352', sector: 'Sector 72', ra: '84.120°', dec: '-23.891°', mag: '9.8', status: 'INGESTED' },
    { ticId: 'TIC 389201948', sector: 'Sector 71', ra: '210.892°', dec: '+12.441°', mag: '13.1', status: 'PREPROCESSED' },
    { ticId: 'TIC 098421033', sector: 'Sector 71', ra: '15.340°', dec: '-65.129°', mag: '10.5', status: 'INGESTED' },
  ];

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search TIC ID or Sector..."
            className="w-full bg-slate-900/80 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button className="btn-secondary text-xs">
          <Filter className="w-4 h-4" /> Filter Catalog
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900/80 text-xs uppercase font-semibold text-slate-400 border-b border-white/5">
            <tr>
              <th className="px-4 py-3">TIC ID</th>
              <th className="px-4 py-3">Sector</th>
              <th className="px-4 py-3">R.A.</th>
              <th className="px-4 py-3">Declination</th>
              <th className="px-4 py-3">TESS Mag</th>
              <th className="px-4 py-3">Pipeline Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {targets.map((row, idx) => (
              <tr key={idx} className="hover:bg-white/5 transition">
                <td className="px-4 py-3 font-mono font-semibold text-indigo-300">{row.ticId}</td>
                <td className="px-4 py-3 text-slate-300">{row.sector}</td>
                <td className="px-4 py-3 font-mono text-slate-400">{row.ra}</td>
                <td className="px-4 py-3 font-mono text-slate-400">{row.dec}</td>
                <td className="px-4 py-3 font-mono text-slate-300">{row.mag}</td>
                <td className="px-4 py-3">
                  <span className="badge badge-emerald">{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
