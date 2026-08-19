import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';

import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import AnomaliesPage from '@/pages/anomalies/page';
import CandidatesPage from '@/pages/candidates/page';
import CandidateDetailPage from '@/pages/candidates/detail-page';
import OverviewPage from '@/pages/overview/page';
import MonitoringPage from '@/pages/monitoring/page';
import TargetsPage from '@/pages/targets/page';
import TargetDetailPage from '@/pages/targets/detail-page';
import ExoplanetsPage from '@/pages/exoplanets/page';
import ModelsPage from '@/pages/models/page';
import PreprocessingPage from '@/pages/preprocessing/page';
import IngestPage from '@/pages/ingest/page';
import DatasetsPage from '@/pages/datasets/page';

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
                <main className="flex-1 overflow-y-auto p-4 md:p-6">
                  <Routes>
                    <Route path="/" element={<OverviewPage />} />
                    <Route path="/targets" element={<TargetsPage />} />
                    <Route path="/targets/:ticId" element={<TargetDetailPage />} />
                    <Route path="/exoplanets" element={<ExoplanetsPage />} />
                    <Route path="/ingest" element={<IngestPage />} />
                    <Route path="/preprocessing" element={<PreprocessingPage />} />
                    <Route path="/datasets" element={<DatasetsPage />} />
                    <Route path="/candidates" element={<CandidatesPage />} />
                    <Route path="/candidates/:predictionId" element={<CandidateDetailPage />} />
                    <Route path="/anomalies" element={<AnomaliesPage />} />
                    <Route path="/models" element={<ModelsPage />} />
                    <Route path="/monitoring" element={<MonitoringPage />} />
                  </Routes>
                </main>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </Router>
  );
}
