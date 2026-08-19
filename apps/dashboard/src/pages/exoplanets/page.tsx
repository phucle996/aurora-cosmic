import { useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { ExternalLink, Flame, Info, Orbit, Rotate3D, Search, Sparkles, Star, Telescope, ThermometerSun } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrbitViewer3D } from '@/components/OrbitViewer3D';

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

const featuredSystems = [
  { id: 'TOI_700', label: 'TOI-700', desc: 'TESS Habitable Zone Earth-size' },
  { id: 'HD_21749', label: 'HD 21749', desc: 'TESS TOI-186 system' },
  { id: 'LHS_3844', label: 'LHS 3844', desc: 'TESS TOI-136 rocky world' },
  { id: 'TRAPPIST-1', label: 'TRAPPIST-1', desc: '7 Earth-sized planets' },
  { id: 'Kepler-186', label: 'Kepler-186', desc: 'First Earth-sized in HZ' },
  { id: 'Proxima_Centauri', label: 'Proxima Centauri', desc: 'Nearest exoplanet system' },
  { id: '55_Cancri', label: '55 Cancri', desc: 'Super-Earth lava world' },
  { id: 'HD_60779', label: 'HD 60779', desc: 'Host star system' },
];

const presetSimulations = [
  {
    id: 'toi-700',
    name: 'TOI-700 (TESS Habitable Zone)',
    star: { name: 'TOI-700', teff: 3480, radius: 0.42, mass: 0.416, mag: 13.1 },
    planets: [
      { name: 'TOI-700 b', radiusEarth: 1.01, periodDays: 9.98, semiMajorAxisAu: 0.0677, tempK: 440, habitabilityScore: 35 },
      { name: 'TOI-700 c', radiusEarth: 2.63, periodDays: 16.05, semiMajorAxisAu: 0.0929, tempK: 370, habitabilityScore: 40 },
      { name: 'TOI-700 d', radiusEarth: 1.14, periodDays: 37.42, semiMajorAxisAu: 0.1633, tempK: 269, habitabilityScore: 92, habitabilityTier: 'high_priority' },
      { name: 'TOI-700 e', radiusEarth: 0.95, periodDays: 27.81, semiMajorAxisAu: 0.134, tempK: 295, habitabilityScore: 88, habitabilityTier: 'promising' },
    ],
  },
  {
    id: 'trappist-1',
    name: 'TRAPPIST-1 (7 Earth-sized System)',
    star: { name: 'TRAPPIST-1', teff: 2566, radius: 0.121, mass: 0.089, mag: 18.8 },
    planets: [
      { name: 'TRAPPIST-1 b', radiusEarth: 1.116, periodDays: 1.51, semiMajorAxisAu: 0.0115, tempK: 400, habitabilityScore: 30 },
      { name: 'TRAPPIST-1 c', radiusEarth: 1.097, periodDays: 2.42, semiMajorAxisAu: 0.0158, tempK: 342, habitabilityScore: 45 },
      { name: 'TRAPPIST-1 d', radiusEarth: 0.788, periodDays: 4.05, semiMajorAxisAu: 0.0223, tempK: 288, habitabilityScore: 85, habitabilityTier: 'promising' },
      { name: 'TRAPPIST-1 e', radiusEarth: 0.920, periodDays: 6.10, semiMajorAxisAu: 0.0293, tempK: 251, habitabilityScore: 95, habitabilityTier: 'high_priority' },
      { name: 'TRAPPIST-1 f', radiusEarth: 1.045, periodDays: 9.21, semiMajorAxisAu: 0.0385, tempK: 219, habitabilityScore: 78 },
      { name: 'TRAPPIST-1 g', radiusEarth: 1.129, periodDays: 12.35, semiMajorAxisAu: 0.0469, tempK: 198, habitabilityScore: 65 },
    ],
  },
  {
    id: 'hd-21749',
    name: 'HD 21749 (TOI-186 Sub-Neptune)',
    star: { name: 'HD 21749', teff: 4571, radius: 0.69, mass: 0.68, mag: 8.1 },
    planets: [
      { name: 'HD 21749 b', radiusEarth: 2.61, periodDays: 35.61, semiMajorAxisAu: 0.192, tempK: 408, habitabilityScore: 48 },
      { name: 'HD 21749 c', radiusEarth: 0.89, periodDays: 7.78, semiMajorAxisAu: 0.069, tempK: 680, habitabilityScore: 20 },
    ],
  },
  {
    id: 'ai-candidate-s42',
    name: 'Aurora ML Candidate (TIC 318942709)',
    star: { name: 'TIC 318942709', teff: 5778, radius: 1.0, mass: 1.0, mag: 10.5 },
    planets: [
      { name: 'cand-s0042-tic0000000318942709-p01', radiusEarth: 1.25, periodDays: 14.8, semiMajorAxisAu: 0.118, tempK: 285, habitabilityScore: 86, habitabilityTier: 'promising' },
    ],
  },
];

export default function ExoplanetsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSystem = normalizeSystemId(searchParams.get('system') ?? '') ?? defaultSystem;
  const [query, setQuery] = useState(requestedSystem.replace(/_/g, ' '));
  const [error, setError] = useState<string>();
  const [selectedSimIndex, setSelectedSimIndex] = useState(0);
  const embedUrl = nasaEyesUrl(requestedSystem);

  useEffect(() => {
    setQuery(requestedSystem.replace(/_/g, ' '));
    setError(undefined);
  }, [requestedSystem]);

  function openSystem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const systemId = normalizeSystemId(query);
    if (!systemId) {
      setError('Nhập mã hệ hành tinh, ví dụ TOI 700 hoặc TRAPPIST-1.');
      return;
    }
    setError(undefined);
    setQuery(systemId.replace(/_/g, ' '));
    setSearchParams({ system: systemId });
  }

  function selectFeatured(systemId: string): void {
    setError(undefined);
    setQuery(systemId.replace(/_/g, ' '));
    setSearchParams({ system: systemId });
  }

  const currentSim = presetSimulations[selectedSimIndex] ?? presetSimulations[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Orbit className="size-4 text-primary" aria-hidden="true" />
            3D Planetary Simulation & NASA Eyes
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">3D Exoplanet Explorer</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Mô phỏng quỹ đạo 3D vật lý thời gian thực cho bất kỳ ứng viên nào, kết hợp mô hình NASA Eyes on Exoplanets.
          </p>
        </div>
      </div>

      <Tabs defaultValue="aurora-3d" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="aurora-3d" className="flex items-center gap-2">
            <Rotate3D className="size-4 text-primary" />
            Aurora 3D Simulator
          </TabsTrigger>
          <TabsTrigger value="nasa-eyes" className="flex items-center gap-2">
            <Telescope className="size-4 text-primary" />
            NASA Eyes (Confirmed)
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AURORA NATIVE 3D SIMULATOR */}
        <TabsContent value="aurora-3d" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-5 text-primary" />
                    Select Planetary System to Simulate in 3D
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Hệ thống tính toán góc nhìn 3D, độ nghiêng quỹ đạo, phân bố nhiệt độ và Vùng sinh sống (Habitable Zone).
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presetSimulations.map((sim, idx) => (
                    <Button
                      key={sim.id}
                      variant={idx === selectedSimIndex ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 text-xs font-mono"
                      onClick={() => setSelectedSimIndex(idx)}
                    >
                      {sim.name}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <OrbitViewer3D
                star={currentSim.star}
                planets={currentSim.planets}
                height="680px"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: NASA EYES INTEGRATION */}
        <TabsContent value="nasa-eyes" className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><Telescope className="size-5 text-primary" />NASA Eyes System Lookup</CardTitle>
                  <CardDescription className="mt-1">Nhập tên hệ sao / TOI (ví dụ: TOI 700, HD 21749, TRAPPIST-1) hoặc chọn các hệ mẫu.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono">{requestedSystem}</Badge>
                  <Button asChild variant="outline" size="sm">
                    <a href={embedUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5 mr-1" />
                      Full Screen
                    </a>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={openSystem}>
                <div className="min-w-0 flex-1">
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Planet or system identifier"
                    placeholder="TOI 700, HD 21749, TRAPPIST-1, Kepler-186..."
                    autoComplete="off"
                  />
                  {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                </div>
                <Button type="submit"><Search aria-hidden="true" />Explore system</Button>
              </form>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Featured / Verified TESS & Exoplanet Systems:</p>
                <div className="flex flex-wrap gap-2">
                  {featuredSystems.map((sys) => {
                    const isActive = requestedSystem.toLowerCase() === sys.id.toLowerCase();
                    return (
                      <Button
                        key={sys.id}
                        variant={isActive ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs font-mono"
                        onClick={() => selectFeatured(sys.id)}
                      >
                        {sys.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-muted/20 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Rotate3D className="size-5 text-primary" />NASA Eyes Interactive Model</CardTitle>
                  <CardDescription className="mt-1">Kéo để xoay, cuộn để zoom và chọn thiên thể để xem dữ liệu chi tiết từ NASA JPL.</CardDescription>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

