import type { JSX } from 'react';
import AnomaliesSection from './sections/AnomaliesSection';

export default function AnomaliesPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl leading-8 font-semibold text-white font-display">Anomaly Engine</h2>
        <p className="text-sm text-slate-400">Unsupervised stellar flare & binary star signal anomaly detection.</p>
      </div>

      <AnomaliesSection />
    </div>
  );
}
