import type { JSX } from 'react';

import CandidatesSection from '@/features/candidates/CandidatesSection';

export default function CandidateReviewPage(): JSX.Element {
  return (
    <CandidatesSection
      detailPath="/research-factory/candidates"
      eyebrow="Scientific Research Factory · ranked evidence + human decision"
      title="Candidate Review"
      description="Một hàng đợi duy nhất để xếp hạng tín hiệu ML, kiểm tra bằng chứng đo được và ghi quyết định review vào training cohort mà không sửa Gold bất biến."
    />
  );
}
