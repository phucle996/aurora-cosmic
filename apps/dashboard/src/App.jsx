import React, { useState } from 'react';
import { 
  Activity, Database, Radio, Bell, LayoutDashboard, Target, 
  Sparkles, AlertTriangle, Server, ArrowUpRight, CheckCircle2, ShieldCheck 
} from 'lucide-react';
import './index.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');

  const menuItems = [
    { id: 'overview', label: 'Platform Overview', icon: LayoutDashboard },
    { id: 'targets', label: 'TESS Target Discovery', icon: Target },
    { id: 'candidates', label: 'ML Transit Candidates', icon: Sparkles },
    { id: 'anomalies', label: 'Anomaly Engine', icon: AlertTriangle },
    { id: 'system', label: 'System Topology', icon: Server },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Header Navigation */}
      <header className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between bg-[#0b0f19]/80 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 font-display">
              AURORA <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">React Vite</span>
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

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="w-64 glass-card m-4 p-4 flex flex-col justify-between hidden md:flex shrink-0">
          <div className="space-y-6">
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Navigation Menu
            </div>
            <nav className="space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                      isActive
                        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-900/30 to-purple-900/30 border border-indigo-500/20 text-xs">
            <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-1">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              Pipeline Engine Active
            </div>
            <p className="text-slate-400 leading-relaxed">
              Streaming NASA FITS files directly into MinIO Bronze layer with rolling 50GB storage.
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white font-display">System Overview</h2>
                <p className="text-sm text-slate-400">Real-time status of 6 pipeline microservices & ingestion metrics.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-5">
                  <div className="text-xs font-semibold text-slate-400 uppercase">Ingested FITS Files</div>
                  <div className="text-2xl font-bold text-white mt-1">128,490</div>
                  <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                    <ArrowUpRight className="w-4 h-4" /> +14.2% from Sector 71
                  </div>
                </div>

                <div className="glass-card p-5">
                  <div className="text-xs font-semibold text-slate-400 uppercase">Bronze Storage Budget</div>
                  <div className="text-2xl font-bold text-white mt-1">14.2 / 50.0 GB</div>
                  <div className="text-xs text-cyan-400 mt-2">28.4% Capacity (High WM: 90%)</div>
                </div>

                <div className="glass-card p-5">
                  <div className="text-xs font-semibold text-slate-400 uppercase">ML Transit Candidates</div>
                  <div className="text-2xl font-bold text-white mt-1">3,421</div>
                  <div className="text-xs text-indigo-400 mt-2">1D-CNN Model Accuracy: 96.8%</div>
                </div>

                <div className="glass-card p-5">
                  <div className="text-xs font-semibold text-slate-400 uppercase">Detected Anomalies</div>
                  <div className="text-2xl font-bold text-white mt-1">412</div>
                  <div className="text-xs text-amber-400 mt-2">12 Stellar Flares Pending Review</div>
                </div>
              </div>

              {/* Service Grid */}
              <div className="glass-card p-6 space-y-4">
                <h3 className="text-lg font-bold text-white font-display">Microservice Topology Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { name: 'go-ingester', role: 'NASA MAST FITS Streaming', lang: 'Go 1.26', status: 'RUNNING' },
                    { name: 'rust-preprocessor', role: 'Tokio Signal Preprocessing', lang: 'Rust 1.89', status: 'RUNNING' },
                    { name: 'python-ml-worker', role: 'PyTorch Candidate Model', lang: 'Python 3.12', status: 'RUNNING' },
                    { name: 'rust-inference', role: 'ONNX Serving Engine', lang: 'Rust 1.89', status: 'RUNNING' },
                    { name: 'go-api', role: 'REST Query Gateway', lang: 'Go 1.26', status: 'RUNNING' },
                    { name: 'dashboard', role: 'React + Vite Scientific Web App', lang: 'React / Vite', status: 'ACTIVE' },
                  ].map((srv, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                      <div>
                        <div className="font-mono font-semibold text-indigo-300 text-sm">{srv.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{srv.role}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-1">{srv.lang}</div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {srv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab !== 'overview' && (
            <div className="glass-card p-12 text-center space-y-3">
              <ShieldCheck className="w-12 h-12 text-indigo-400 mx-auto" />
              <h3 className="text-xl font-bold text-white font-display">React Vite Page Component</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Viewing active view: <span className="font-mono text-indigo-300 font-bold">{activeTab}</span>. Initialized using Vite React template.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
