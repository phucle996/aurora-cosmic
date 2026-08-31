import type { JSX } from 'react';

import CandidatesSection from '@/pages/candidates/sections/CandidatesSection';

export default function ResearchVettingPage(): JSX.Element {
  return <CandidatesSection detailPath="/research-factory/transit-candidates" eyebrow="Scientific Research Factory · evidence review" title="Target Vetting" description="This is the live candidate workflow, not a shortcut page. Every score, curve and physical assessment below is read from the completed inference job and its immutable Gold snapshot." />;
}
