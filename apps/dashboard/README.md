# AURORA Dashboard

React 19 + Vite dashboard for the AURORA scientific data platform.

## UI foundation

The dashboard uses Tailwind CSS v4 and shadcn/ui source components. The
component sources live in `src/components/ui/` and are owned by this project;
they can be updated with the shadcn CLI when the upstream registry changes.

The full shadcn registry is vendored locally (`npx shadcn@latest add --all`).
The application shell uses the generated `Sidebar`, `SidebarProvider`,
`SidebarTrigger`, `Breadcrumb`, `Button`, `Avatar`, `Tooltip`, and `Separator`
primitives.

## Structure

```text
src/
├── components/       shared application components and shadcn/ui primitives
├── hooks/             reusable UI hooks
├── lib/               shared utilities (`cn`)
├── pages/             route-level features
└── App.tsx            router and application shell
```

## Commands

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run build
```

`VITE_AURORA_API_URL` is reserved for the API client layer. The current shell
does not fabricate backend data; feature pages should consume versioned Go API
contracts as they are wired in.
