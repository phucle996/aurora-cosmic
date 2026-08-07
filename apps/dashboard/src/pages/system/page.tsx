import React from 'react';
import HealthSection from './sections/HealthSection';

export default function SystemHealthPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white font-display">System Topology & Health</h2>
        <p className="text-sm text-slate-400">Microservice connectivity, storage limits, and event bus status.</p>
      </div>

      <HealthSection />
    </div>
  );
}
