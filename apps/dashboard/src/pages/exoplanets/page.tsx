import { useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { ExternalLink, Info, Orbit, Rotate3D, Search, Telescope } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const defaultSystem = 'HD_60779';

function normalizeSystemId(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._+-]/g, '');
  return normalized || undefined;
}

function nasaEyesUrl(systemId: string): string {
  return `https://eyes.nasa.gov/apps/exo/#/system/${encodeURIComponent(systemId)}`;
}

export default function ExoplanetsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSystem = normalizeSystemId(searchParams.get('system') ?? '') ?? defaultSystem;
  const [query, setQuery] = useState(requestedSystem.replace(/_/g, ' '));
  const [error, setError] = useState<string>();
  const embedUrl = nasaEyesUrl(requestedSystem);

  useEffect(() => {
    setQuery(requestedSystem.replace(/_/g, ' '));
    setError(undefined);
  }, [requestedSystem]);

  function openSystem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const systemId = normalizeSystemId(query);
    if (!systemId) {
      setError('Nhập mã hệ hành tinh, ví dụ HD 60779.');
      return;
    }
    setError(undefined);
    setQuery(systemId.replace(/_/g, ' '));
    setSearchParams({ system: systemId });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Orbit className="size-4 text-primary" aria-hidden="true" />
            NASA Eyes integration
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">3D Exoplanet Explorer</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tra cứu theo mã sao hoặc hệ hành tinh và tương tác trực tiếp với mô hình 3D từ NASA Eyes on Exoplanets.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={embedUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open full screen
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Telescope className="size-5 text-primary" />System lookup</CardTitle>
              <CardDescription className="mt-1">Dấu cách được tự động chuyển thành dấu gạch dưới theo URL của NASA.</CardDescription>
            </div>
            <Badge variant="secondary" className="font-mono">{requestedSystem}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={openSystem}>
            <div className="min-w-0 flex-1">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Planet or system identifier"
                placeholder="HD 60779"
                autoComplete="off"
              />
              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </div>
            <Button type="submit"><Search aria-hidden="true" />Explore system</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Rotate3D className="size-5 text-primary" />Interactive system model</CardTitle>
              <CardDescription className="mt-1">Kéo để xoay, cuộn để zoom và chọn thiên thể để xem dữ liệu chi tiết.</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Info className="size-4" />Embedded from eyes.nasa.gov</div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <iframe
            key={embedUrl}
            src={embedUrl}
            title={`NASA Eyes model for ${requestedSystem}`}
            className="h-[70svh] min-h-[560px] w-full border-0 bg-black"
            allow="fullscreen; autoplay; clipboard-write; accelerometer; gyroscope"
            allowFullScreen
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </CardContent>
      </Card>
    </div>
  );
}
