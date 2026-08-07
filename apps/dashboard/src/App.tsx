import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import OverviewPage from './pages/overview/page';
import TargetsPage from './pages/targets/page';
import CandidatesPage from './pages/candidates/page';
import AnomaliesPage from './pages/anomalies/page';
import SystemHealthPage from './pages/system/page';
import './index.css';

export default function App(): JSX.Element {
  return (
    <Router>
      <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
        <Header />

        <div className="flex-1 flex">
          <Sidebar />

          <main className="flex-1 p-6 space-y-6 overflow-y-auto">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/targets" element={<TargetsPage />} />
              <Route path="/candidates" element={<CandidatesPage />} />
              <Route path="/anomalies" element={<AnomaliesPage />} />
              <Route path="/system" element={<SystemHealthPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}
