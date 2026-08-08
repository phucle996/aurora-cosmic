import type { JSX } from 'react';
import CandidatesSection from './sections/CandidatesSection';

export default function CandidatesPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl leading-8 font-semibold text-white font-display">ML Transit Candidates</h2>
        <p className="text-sm text-slate-400">1D-CNN & PyTorch deep learning exoplanet classification predictions.</p>
      </div>

      <CandidatesSection />
    </div>
  );
}
