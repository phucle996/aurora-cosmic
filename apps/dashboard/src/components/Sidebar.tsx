import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Target, Sparkles, AlertTriangle, Server, LucideIcon } from 'lucide-react';

interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export default function Sidebar(): JSX.Element {
  const menuItems: MenuItem[] = [
    { path: '/', label: 'Platform Overview', icon: LayoutDashboard },
    { path: '/targets', label: 'TESS Target Discovery', icon: Target },
    { path: '/candidates', label: 'ML Transit Candidates', icon: Sparkles },
    { path: '/anomalies', label: 'Anomaly Engine', icon: AlertTriangle },
    { path: '/system', label: 'System Topology', icon: Server },
  ];

  return (
    <aside className="w-64 glass-card m-4 p-4 flex flex-col justify-between hidden md:flex shrink-0">
      <div className="space-y-6">
        <div className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Domain Routes
        </div>
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-900/30 to-purple-900/30 border border-indigo-500/20 text-xs">
        <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-1">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          Router DOM Active
        </div>
        <p className="text-slate-400 leading-relaxed">
          Domain-separated TSX subfolders with React Router DOM v6 navigation.
        </p>
      </div>
    </aside>
  );
}
