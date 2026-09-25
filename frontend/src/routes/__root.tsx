import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  Bot, Activity, LayoutDashboard, Package,
  PlusCircle, Shield, Cpu, Bell, ShieldCheck,
} from "lucide-react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";

const NAV_LINKS = [
  { to: "/",           label: "Overview",   icon: LayoutDashboard },
  { to: "/register",   label: "Register",   icon: PlusCircle },
  { to: "/pipeline",   label: "Pipeline",   icon: Activity },
  { to: "/fleet",      label: "Fleet",      icon: Shield },
  { to: "/results",    label: "Results",    icon: ShieldCheck },
  { to: "/catalog",    label: "Catalog",    icon: Package },
];

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(err);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground font-mono text-red-400">{err.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Unified Agent Registry & Red Teaming Platform" },
      { name: "description", content: "Unified platform: register agents, run arctl registry publish, and launch automated red-team evaluations — all in one place." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function TopNav() {
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4 md:px-6">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-indigo-600">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <span className="hidden font-bold text-foreground sm:inline-block">
            <span className="text-violet-500">Unified</span> Platform
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-0.5">
          {NAV_LINKS.map(({ to, label, icon: Icon }) => {
            const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={[
                  "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "text-violet-500 bg-violet-500/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-violet-500" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline">Backend :8050</span>
          </div>
        </div>
      </div>
    </nav>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col bg-background">
        <TopNav />
        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
