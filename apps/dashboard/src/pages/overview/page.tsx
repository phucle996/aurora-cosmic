import React from 'react';
import MetricsSection from './sections/MetricsSection';
import TopologySection from './sections/TopologySection';

export default function OverviewPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white font-display">System Overview</h2>
        <p className="text-sm text-slate-400">Real-time status of 6 pipeline microservices & ingestion metrics.</p>
      </div>

      <MetricsSection />
      <TopologySection />
    </div>
  );
}
