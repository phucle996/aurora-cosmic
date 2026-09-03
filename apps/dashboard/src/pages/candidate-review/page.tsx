import type { JSX } from 'react';

import CandidatesSection from '@/features/candidates/CandidatesSection';

export default function CandidateReviewPage(): JSX.Element {
  return (
    <CandidatesSection
      detailPath="/research-factory/candidates"
      eyebrow="Scientific Research Factory · ranked evidence + human decision"
      title="Candidate Review"
      description="Xếp hạng tín hiệu ML, kiểm tra bằng chứng đo được và ghi quyết định khoa học vào review ledger riêng; Gold và training cohort không bị thay đổi."
    />
  );
}
