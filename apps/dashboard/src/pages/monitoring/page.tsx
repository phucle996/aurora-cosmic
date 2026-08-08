import type { JSX } from 'react';
import HealthSection from './sections/HealthSection';

export default function MonitoringPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl leading-8 font-semibold text-foreground font-display">Monitoring</h2>
        <p className="text-sm text-muted-foreground">Chọn một component để xem từng nhóm metric theo thời gian thực.</p>
      </div>

      <HealthSection />
    </div>
  );
}
