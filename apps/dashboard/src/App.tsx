import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';

import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import AnomaliesPage from '@/pages/anomalies/page';
import CandidatesPage from '@/pages/candidates/page';
import OverviewPage from '@/pages/overview/page';
import SystemHealthPage from '@/pages/system/page';
import TargetsPage from '@/pages/targets/page';

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
                    <Route path="/candidates" element={<CandidatesPage />} />
                    <Route path="/anomalies" element={<AnomaliesPage />} />
                    <Route path="/system" element={<SystemHealthPage />} />
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
