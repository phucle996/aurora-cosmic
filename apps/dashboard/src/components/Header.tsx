import { Bell, CircleHelp } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { JSX } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const pageNames: Record<string, string> = {
  '/': 'Overview',
  '/ingest': 'Ingest & storage',
  '/monitoring': 'Monitoring',
  '/models': 'Models & inference',
};

export default function Header(): JSX.Element {
  const location = useLocation();
  const pageName = location.pathname.startsWith('/targets/')
    ? 'Target detail'
    : location.pathname.startsWith('/candidates/')
      ? 'Candidate detail'
      : location.pathname.startsWith('/gold/snapshots/')
        ? 'Gold file explorer'
      : location.pathname === '/data-factory/preprocessing'
        ? 'Data Factory · Preprocessing'
      : location.pathname === '/data-factory/enrichment'
        ? 'Data Factory · Data Enrichment'
      : location.pathname === '/data-factory/pipeline'
        ? 'Data Factory · Pipeline DAG'
      : location.pathname === '/data-factory/lineage'
        ? 'Data Factory · Lineage Explorer'
      : location.pathname === '/research-factory'
        ? 'Scientific Research Factory'
      : location.pathname === '/research-factory/discovery'
        ? 'Scientific Research Factory · TESS Discovery'
      : location.pathname === '/research-factory/workbench'
        ? 'Scientific Research Factory · Workbench'
      : location.pathname === '/research-factory/transit-candidates'
        ? 'Scientific Research Factory · Transit Candidates'
      : location.pathname.startsWith('/research-factory/transit-candidates/')
        ? 'Scientific Research Factory · Candidate Physics'
      : location.pathname === '/research-factory/systems'
        ? 'Scientific Research Factory · 3D Systems'
      : location.pathname === '/research-factory/vetting'
        ? 'Scientific Research Factory · Vetting'
      : location.pathname === '/research-factory/evidence'
        ? 'Scientific Research Factory · Evidence & Runs'
      : pageNames[location.pathname] ?? 'Dashboard';

  return (
    <header className="sticky top-0 z-20 flex h-16 min-w-0 shrink-0 items-center gap-2 border-b border-border/60 bg-background/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4 md:px-6">
      <SidebarTrigger aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link to="/">AURORA</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{pageName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-2 hidden h-5 sm:block" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Help and documentation" className="hidden sm:inline-flex">
              <CircleHelp aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help and documentation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="hidden sm:inline-flex">
              <Bell aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mx-2 hidden h-5 md:block" />
        <Avatar size="sm" aria-label="AURORA operator" className="hidden md:flex">
          <AvatarFallback>AU</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
