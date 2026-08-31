import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
const CandidateDetailPage = lazy(() => import('@/pages/candidates/detail-page'));
const OverviewPage = lazy(() => import('@/pages/overview/page'));
const MonitoringPage = lazy(() => import('@/pages/monitoring/page'));
const TargetDetailPage = lazy(() => import('@/pages/targets/detail-page'));
const ModelsPage = lazy(() => import('@/pages/models/page'));
const PreprocessingPage = lazy(() => import('@/pages/preprocessing/page'));
const IngestPage = lazy(() => import('@/pages/ingest/page'));
const DatasetsPage = lazy(() => import('@/pages/datasets/page'));
const EnrichmentPage = lazy(() => import('@/pages/enrichment/page'));
const GoldSnapshotPage = lazy(() => import('@/pages/gold/snapshot-page'));
const GoldArtifactPage = lazy(() => import('@/pages/gold/artifact-page'));
const DataFactoryPipelinePage = lazy(() => import('@/pages/data-factory/pipeline-page'));
const DataFactoryLineagePage = lazy(() => import('@/pages/data-factory/lineage-page'));
const DataFactoryHistoryPage = lazy(() => import('@/pages/data-factory/history-page'));
const ResearchFactoryOverviewPage = lazy(() => import('@/pages/research-factory/overview-page'));
const ResearchDiscoveryPage = lazy(() => import('@/pages/research-factory/discovery-page'));
const ResearchWorkbenchPage = lazy(() => import('@/pages/research-factory/workbench-page'));
const ResearchTransitCandidatesPage = lazy(() => import('@/pages/research-factory/transit-candidates-page'));
const ResearchSystemsPage = lazy(() => import('@/pages/research-factory/systems-page'));
const ResearchVettingPage = lazy(() => import('@/pages/research-factory/vetting-page'));
const ResearchEvidencePage = lazy(() => import('@/pages/research-factory/evidence-page'));

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
                    <Route path="/exoplanets" element={<Navigate to="/research-factory/systems" replace />} />
                    <Route path="/ingest" element={<IngestPage />} />
                    <Route path="/preprocessing" element={<Navigate to="/data-factory/preprocessing" replace />} />
                    <Route path="/enrichment" element={<Navigate to="/data-factory/enrichment" replace />} />
                    <Route path="/data-factory/preprocessing" element={<PreprocessingPage />} />
                    <Route path="/data-factory/enrichment" element={<EnrichmentPage />} />
                    <Route path="/data-factory/pipeline" element={<DataFactoryPipelinePage />} />
                    <Route path="/data-factory/lineage" element={<DataFactoryLineagePage />} />
                    <Route path="/data-factory/history" element={<DataFactoryHistoryPage />} />
                    <Route path="/research-factory" element={<ResearchFactoryOverviewPage />} />
                    <Route path="/research-factory/discovery" element={<ResearchDiscoveryPage />} />
                    <Route path="/research-factory/workbench" element={<ResearchWorkbenchPage />} />
                    <Route path="/research-factory/transit-candidates" element={<ResearchTransitCandidatesPage />} />
                    <Route path="/research-factory/transit-candidates/:predictionId" element={<CandidateDetailPage />} />
                    <Route path="/research-factory/systems" element={<ResearchSystemsPage />} />
                    <Route path="/research-factory/vetting" element={<ResearchVettingPage />} />
                    <Route path="/research-factory/evidence" element={<ResearchEvidencePage />} />
                    <Route path="/datasets" element={<DatasetsPage />} />
                    <Route path="/gold/snapshots/:snapshotId" element={<GoldSnapshotPage />} />
                    <Route path="/gold/snapshots/:snapshotId/files/:dataset/:sector" element={<GoldArtifactPage />} />
                    <Route path="/candidates" element={<Navigate to="/research-factory/transit-candidates" replace />} />
                    <Route path="/candidates/:predictionId" element={<CandidateDetailPage />} />
                    <Route path="/models" element={<Navigate to="/ai-factory/registry" replace />} />
                    <Route path="/ai-factory/training" element={<ModelsPage view="training" />} />
                    <Route path="/ai-factory/evaluation" element={<ModelsPage view="evaluation" />} />
                    <Route path="/ai-factory/evidence" element={<ModelsPage view="evidence" />} />
                    <Route path="/ai-factory/registry" element={<ModelsPage view="registry" />} />
                    <Route path="/ai-factory/inference" element={<ModelsPage view="inference" />} />
                    <Route path="/ai-factory/models/:modelId" element={<ModelsPage view="detail" />} />
                    <Route path="/monitoring" element={<MonitoringPage />} />
                  </Routes></Suspense></AppErrorBoundary>
                </main>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </Router>
  );
}
