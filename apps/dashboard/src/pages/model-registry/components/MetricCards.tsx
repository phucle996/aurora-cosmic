import { type JSX } from 'react';
import { BrainCircuit, Clock3, ShieldCheck, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface MetricCardProps {
  icon: typeof BrainCircuit;
  label: string;
  value: number;
  detail: string;
}

export function MetricCard({ icon: Icon, label, value, detail }: MetricCardProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricCardsProps {
  totalModels: number;
  validatedCount: number;
  championCount: number;
  plannedCount: number;
}

export function MetricCards({
  totalModels,
  validatedCount,
  championCount,
  plannedCount,
}: MetricCardsProps): JSX.Element {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
      <MetricCard icon={BrainCircuit} label="Runtime packages" value={totalModels} detail="Đã đăng ký trong MinIO" />
      <MetricCard icon={ShieldCheck} label="Validated" value={validatedCount} detail="Parity status PASS" />
      <MetricCard icon={Sparkles} label="Champions" value={championCount} detail="Mô hình phục vụ chính" />
      <MetricCard icon={Clock3} label="Planned jobs" value={plannedCount} detail="Sẵn sàng cho GPU Inference" />
    </div>
  );
}
