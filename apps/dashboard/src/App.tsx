import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
const OverviewPage = lazy(() => import('@/pages/overview/page'));
const MonitoringPage = lazy(() => import('@/pages/monitoring/page'));
const TargetDetailPage = lazy(() => import('@/pages/target-detail/page'));
const TrainingLabPage = lazy(() => import('@/pages/training-lab/page'));
const LabelingStudioPage = lazy(() => import('@/pages/labeling-studio/page'));
const ModelEvaluationPage = lazy(() => import('@/pages/model-evaluation/page'));
const EvolutionEvidencePage = lazy(() => import('@/pages/evolution-evidence/page'));
const InferenceEnginePage = lazy(() => import('@/pages/inference-engine/page'));
const PreprocessingPage = lazy(() => import('@/pages/preprocessing/page'));
const IngestPage = lazy(() => import('@/pages/ingest/page'));
const LakehousePage = lazy(() => import('@/pages/lakehouse/page'));
const LakehouseInspectorPage = lazy(() => import('@/pages/lakehouse-inspector/page'));
const EnrichmentPage = lazy(() => import('@/pages/enrichment/page'));
const PipelineDagPage = lazy(() => import('@/pages/pipeline-dag/page'));
const LineageExplorerPage = lazy(() => import('@/pages/lineage-explorer/page'));
const RunnerTicketsPage = lazy(() => import('@/pages/runner-tickets/page'));
const TargetDiscoveryPage = lazy(() => import('@/pages/target-discovery/page'));

export default function App(): JSX.Element {
  return (
    <Router>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <div className="min-h-svh bg-background text-foreground">
            <SidebarProvider>
              <Sidebar />
              <SidebarInset>
                <Header />
                <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
                  <AppErrorBoundary><Suspense fallback={<div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Loading dashboard view…</div>}><Routes>
                    <Route path="/" element={<OverviewPage />} />
                    <Route path="/targets" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/targets/:ticId" element={<TargetDetailPage />} />
                    <Route path="/exoplanets" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/ingest" element={<IngestPage />} />
                    <Route path="/preprocessing" element={<Navigate to="/data-factory/preprocessing" replace />} />
                    <Route path="/enrichment" element={<Navigate to="/data-factory/enrichment" replace />} />
                    <Route path="/data-factory/preprocessing" element={<PreprocessingPage />} />
                    <Route path="/data-factory/enrichment" element={<EnrichmentPage />} />
                    <Route path="/data-factory/pipeline" element={<PipelineDagPage />} />
                    <Route path="/data-factory/dag" element={<Navigate to="/data-factory/pipeline" replace />} />
                    <Route path="/data-factory/lineage" element={<LineageExplorerPage />} />
                    <Route path="/ticket" element={<RunnerTicketsPage />} />
                    <Route path="/tickets" element={<Navigate to="/ticket" replace />} />
                    <Route path="/data-factory/history" element={<Navigate to="/ticket" replace />} />
                    <Route path="/data-factory/tickets" element={<Navigate to="/ticket" replace />} />
                    <Route path="/data-factory/runs" element={<Navigate to="/ticket" replace />} />
                    <Route path="/research-factory" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/discovery" element={<TargetDiscoveryPage />} />
                    <Route path="/research-factory/workbench" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/workbench/:ticId" element={<TargetDetailPage />} />
                    <Route path="/research-factory/candidates" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/candidates/:predictionId" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/history" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/transit-candidates" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/transit-candidates/:predictionId" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/vetting" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/systems" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/research-factory/evidence" element={<Navigate to="/ai-factory/evidence" replace />} />
                    <Route path="/lakehouse" element={<LakehousePage />} />
                    <Route path="/lakehouse/inspector" element={<LakehouseInspectorPage />} />
                    <Route path="/lakehouse/inspect" element={<Navigate to="/lakehouse/inspector" replace />} />
                    <Route path="/datasets" element={<Navigate to="/lakehouse" replace />} />
                    <Route path="/candidates" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/candidates/:predictionId" element={<Navigate to="/research-factory/discovery" replace />} />
                    <Route path="/models" element={<Navigate to="/ai-factory/inference" replace />} />
                    <Route path="/ai-factory/training" element={<TrainingLabPage />} />
                    <Route path="/ai-factory/labeling" element={<LabelingStudioPage />} />
                    <Route path="/ai-factory/evaluation" element={<ModelEvaluationPage />} />
                    <Route path="/ai-factory/evidence" element={<EvolutionEvidencePage />} />
                    <Route path="/ai-factory/registry" element={<Navigate to="/ai-factory/inference" replace />} />
                    <Route path="/ai-factory/inference" element={<InferenceEnginePage />} />
                    <Route path="/ai-factory/models/:modelId" element={<Navigate to="/ai-factory/inference" replace />} />
                    <Route path="/monitoring" element={<MonitoringPage />} />
                  </Routes></Suspense></AppErrorBoundary>
                </main>
              </SidebarInset>
            </SidebarProvider>
          </div>
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </Router>
  );
}
