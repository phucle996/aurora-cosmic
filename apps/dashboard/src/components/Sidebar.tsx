import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Database,
  DownloadCloud,
  LayoutDashboard,
  Orbit,
  Server,
  Sparkles,
  Target,
  Workflow,
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
} from '@/components/ui/sidebar';

const menuItems = [
  { path: '/', label: 'Platform Overview', icon: LayoutDashboard },
  { path: '/targets', label: 'TESS Target Discovery', icon: Target },
  { path: '/exoplanets', label: '3D Exoplanet Explorer', icon: Orbit },
  { path: '/ingest', label: 'Ingest Pipeline', icon: DownloadCloud },
  { path: '/preprocessing', label: 'Preprocessing & Lineage', icon: Workflow },
  { path: '/datasets', label: 'Datasets (Lakehouse)', icon: Database },
  { path: '/candidates', label: 'ML Transit Candidates', icon: Sparkles },
  { path: '/anomalies', label: 'Anomaly Engine', icon: AlertTriangle },
  { path: '/models', label: 'Models & Inference', icon: BrainCircuit },
  { path: '/monitoring', label: 'Monitoring', icon: Server },
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
