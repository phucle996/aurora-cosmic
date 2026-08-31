import type { JSX } from 'react';

import CandidatesSection from '@/pages/candidates/sections/CandidatesSection';

export default function ResearchTransitCandidatesPage(): JSX.Element {
  return <CandidatesSection detailPath="/research-factory/transit-candidates" eyebrow="Scientific Research Factory · evidence ranking" title="Transit Candidate Analysis" description="Inspect the latest completed candidate-vetting run. Scores are never treated as a verdict; each candidate keeps its Gold snapshot and measured evidence." />;
}
