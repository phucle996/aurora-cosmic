import type { JSX } from 'react';
import TargetsTableSection from './sections/TargetsTableSection';

export default function TargetsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl leading-8 font-semibold text-white font-display">TESS Target Discovery</h2>
        <p className="text-sm text-slate-400">Target Pixel Files & Light Curves from NASA MAST archive.</p>
      </div>

      <TargetsTableSection />
    </div>
  );
}
