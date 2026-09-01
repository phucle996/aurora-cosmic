import {
  Activity,
  BrainCircuit,
	Clock3,
  Database,
  DownloadCloud,
  Factory,
  GitBranch,
  LayoutDashboard,
  Microscope,
  Server,
  Sparkles,
  Target,
  Workflow,
  Waves,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import type { JSX } from 'react';

import {
  Sidebar as UISidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';

const menuItems = [
  { path: '/', label: 'Platform Overview', icon: LayoutDashboard },
  { path: '/ingest', label: 'Ingest Pipeline', icon: DownloadCloud },
  { path: '/datasets', label: 'Datasets (Lakehouse)', icon: Database },
  { path: '/monitoring', label: 'Monitoring', icon: Server },
];

const dataFactoryItems = [
  { path: '/data-factory/preprocessing', label: 'Preprocessing', detail: 'Run Bronze → Silver', icon: Workflow },
  { path: '/data-factory/enrichment', label: 'Data Enrichment', detail: 'Silver → Gold', icon: Waves },
  { path: '/data-factory/pipeline', label: 'Pipeline DAG', detail: 'Bronze → Gold footprint', icon: Factory },
  { path: '/data-factory/history', label: 'Run History', detail: 'Durable batch + stream ledger', icon: Clock3 },
  { path: '/data-factory/lineage', label: 'Lineage Explorer', detail: 'Artifact provenance', icon: GitBranch },
];

const researchFactoryItems = [
  { path: '/research-factory/discovery', label: 'TESS Target Discovery', detail: 'Find research targets', icon: Target },
  { path: '/research-factory/workbench', label: 'Observation Workbench', detail: 'LC, BLS, TPF + 3D physics', icon: Microscope },
  { path: '/research-factory/candidates', label: 'Candidate Review', detail: 'Rank, vet and label evidence', icon: Sparkles },
  { path: '/research-factory/history', label: 'Research History', detail: 'Gold → model → decision', icon: GitBranch },
];

const aiFactoryItems = [
  { path: '/ai-factory/training', label: 'Training Lab', detail: 'Gold → trained model', icon: BrainCircuit },
  { path: '/ai-factory/evaluation', label: 'Model Evaluation', detail: 'Quality + parity checks', icon: Activity },
  { path: '/ai-factory/evidence', label: 'Evolution Evidence', detail: 'Data and model provenance', icon: GitBranch },
  { path: '/ai-factory/registry', label: 'Model Registry', detail: 'Promote and roll back', icon: Database },
  { path: '/ai-factory/inference', label: 'Inference Engine', detail: 'Batch + stream scoring', icon: Sparkles },
];

export default function Sidebar(): JSX.Element {
  const location = useLocation();

  return (
    <UISidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Activity className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate font-heading text-sm font-semibold tracking-tight">AURORA</p>
            <p className="truncate text-xs text-sidebar-foreground/60">Cosmic data platform</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/65">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path);

                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className="font-medium">
                      <NavLink to={item.path}>
                        <Icon className="size-4" aria-hidden="true" />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={location.pathname.startsWith('/data-factory/')} tooltip="Data Factory" className="font-medium">
                  <Factory className="size-4" aria-hidden="true" />
                  <span>Data Factory</span>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  {dataFactoryItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                      <SidebarMenuSubItem key={item.path}>
                        <SidebarMenuSubButton asChild isActive={isActive}>
                          <NavLink to={item.path}>
                            <Icon className="size-3.5" aria-hidden="true" />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={location.pathname.startsWith('/ai-factory/')} tooltip="AI Factory" className="font-medium">
                  <BrainCircuit className="size-4" aria-hidden="true" />
                  <span>AI Factory</span>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  {aiFactoryItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                      <SidebarMenuSubItem key={item.path}>
                        <SidebarMenuSubButton asChild isActive={isActive}>
                          <NavLink to={item.path}>
                            <Icon className="size-3.5" aria-hidden="true" />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname.startsWith('/research-factory/')} tooltip="Scientific Research Factory" className="font-medium">
                  <NavLink to="/research-factory">
                    <Microscope className="size-4" aria-hidden="true" />
                    <span>Scientific Research Factory</span>
                  </NavLink>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  {researchFactoryItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                      <SidebarMenuSubItem key={item.path}>
                        <SidebarMenuSubButton asChild isActive={isActive}>
                          <NavLink to={item.path}>
                            <Icon className="size-3.5" aria-hidden="true" />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
        <div className="rounded-md border border-sidebar-border bg-sidebar-accent/50 p-2.5 text-xs text-sidebar-foreground/70">
          <p className="font-medium text-sidebar-foreground">AURORA Production v1.0</p>
          <p className="mt-0.5 text-[11px]">NASA TESS / Kepler High-Throughput Stream</p>
        </div>
      </SidebarFooter>
    </UISidebar>
  );
}
