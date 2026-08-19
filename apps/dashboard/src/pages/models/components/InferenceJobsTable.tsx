import type { JSX } from 'react';
import { Database, LoaderCircle, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, statusVariant } from '../types';
import type { InferenceJob, ModelRecord } from '../types';

interface InferenceJobsTableProps {
  selectedModel?: ModelRecord;
  jobs: InferenceJob[];
  onQueueJob: (job: InferenceJob) => Promise<void>;
  queueingJobId?: string;
}

export function InferenceJobsTable({
  selectedModel,
  jobs,
  onQueueJob,
  queueingJobId,
}: InferenceJobsTableProps): JSX.Element {
  const selectedJobs = selectedModel
    ? jobs.filter(
      (job) => job.model_id === selectedModel.model_id || job.runtime_package_id === selectedModel.runtime_package_id,
    )
    : [];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Danh sách Inference Jobs</CardTitle>
        <CardDescription>Đưa các snapshot dữ liệu vào hàng đợi để GPU Rust Inference Engine chấm điểm hàng loạt.</CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedModel ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="size-6 opacity-60" />
            <p>Chọn model để xem các Gold jobs tương thích.</p>
          </div>
        ) : selectedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="size-6 opacity-60" />
            <p>Không có Gold job nào đã pin vào runtime này.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Mã Job</TableHead>
                  <TableHead>Gold Snapshot</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Số lượng mẫu</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedJobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell>
                      <p className="font-mono text-xs font-medium">{job.job_id}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(job.created_at)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{job.gold_snapshot_id}</p>
                      <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{job.gold_artifact_key}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{job.sector}</TableCell>
                    <TableCell className="font-mono text-xs">{job.expected_prediction_count.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={job.status === 'completed' ? 'outline' : 'default'}
                        onClick={() => void onQueueJob(job)}
                        disabled={queueingJobId === job.job_id || selectedModel.status === 'invalid'}
                      >
                        {queueingJobId === job.job_id ? <LoaderCircle className="animate-spin size-3.5" /> : <Play className="size-3.5" />}
                        {queueingJobId === job.job_id ? 'Đang xếp hàng…' : job.status === 'completed' ? 'Chạy lại' : 'Queue GPU'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
