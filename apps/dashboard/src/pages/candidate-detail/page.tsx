import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import type { CandidateDetailResponse } from '@/lib/analytics-types';

/**
 * CandidateDetailPage handles legacy / direct candidate URLs by resolving
 * the host TIC ID and automatically redirecting to the unified Scientific Workbench.
 */
export default function CandidateDetailPage(): JSX.Element {
  const { predictionId = '' } = useParams();
  const [search] = useSearchParams();
  const snapshot = search.get('snapshot_id') ?? '';
  const [targetRedirect, setTargetRedirect] = useState<{ ticId: number; sector: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!predictionId) return;
    let active = true;
    const query = snapshot ? `?snapshot_id=${encodeURIComponent(snapshot)}` : '';
    apiFetch<CandidateDetailResponse>(`/v1/candidates/${encodeURIComponent(predictionId)}${query}`)
      .then((data) => {
        if (!active) return;
        if (data.candidate && data.candidate.tic_id > 0) {
          setTargetRedirect({
            ticId: data.candidate.tic_id,
            sector: data.candidate.sector,
          });
        } else {
          setError('Host target context unavailable');
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to resolve candidate target');
      });
    return () => {
      active = false;
    };
  }, [predictionId, snapshot]);

  if (!predictionId) {
    return <Navigate to="/research-factory/candidates" replace />;
  }

  if (targetRedirect) {
    const snapshotParam = snapshot ? `&snapshot_id=${encodeURIComponent(snapshot)}` : '';
    return (
      <Navigate
        to={`/research-factory/workbench/${targetRedirect.ticId}?sector=${targetRedirect.sector}${snapshotParam}&prediction_id=${encodeURIComponent(predictionId)}`}
        replace
      />
    );
  }

  if (error) {
    return (
      <Navigate
        to={`/research-factory/candidates?prediction_id=${encodeURIComponent(predictionId)}`}
        replace
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-sm text-muted-foreground">
      <LoaderCircle className="size-6 animate-spin text-primary" />
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Đang chuyển hướng sang Scientific Target Workbench…
      </p>
    </div>
  );
}
