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
  '/targets': 'Targets',
  '/candidates': 'Candidates',
  '/anomalies': 'Anomalies',
  '/system': 'System health',
  '/models': 'Models & inference',
};

export default function Header(): JSX.Element {
  const location = useLocation();
  const pageName = pageNames[location.pathname] ?? 'Dashboard';

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <Breadcrumb>
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

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-2 h-5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Help and documentation">
              <CircleHelp aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help and documentation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mx-2 h-5" />
        <Avatar size="sm" aria-label="AURORA operator">
          <AvatarFallback>AU</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
