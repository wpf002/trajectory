import { useEffect, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Sidebar, MobileHeader } from "@/components/Sidebar";
import { ShortcutHelp } from "@/components/OnboardingHint";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTrajectoryStore } from "@/lib/store";
import { DRIVERS, DriverId } from "../../shared/model";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Signals from "@/pages/Signals";
import External from "@/pages/External";
import Calibration from "@/pages/Calibration";
import ModelReleases from "@/pages/ModelReleases";
import Assumptions from "@/pages/Assumptions";
import Watchlist from "@/pages/Watchlist";
import Portfolio from "@/pages/Portfolio";
import Decisions from "@/pages/Decisions";
import Sources from "@/pages/Sources";

/**
 * Hydrate driver state from URL query params (e.g. ?ai_capability=72&labor_automation=41).
 * Values are percentages (0-100). Run once on mount.
 */
function useUrlStateHydration() {
  const { setDriverValue } = useTrajectoryStore();
  useEffect(() => {
    // wouter's hash location strips the leading "#" — inspect it manually
    const hash = window.location.hash; // like "#/?ai_capability=72&..."
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const validIds = new Set(DRIVERS.map(d => d.id));
    let touched = false;
    for (const [k, v] of params.entries()) {
      if (!validIds.has(k as DriverId)) continue;
      const n = parseInt(v, 10);
      if (isNaN(n)) continue;
      const clamped = Math.max(0, Math.min(100, n)) / 100;
      setDriverValue(k as DriverId, clamped);
      touched = true;
    }
    // If we hydrated from URL, strip the query so subsequent shares don't stack
    if (touched) {
      const cleanHash = hash.slice(0, qIdx);
      window.history.replaceState(null, "", window.location.pathname + window.location.search + cleanHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Load the news-derived forecast from the server and make it the dashboard's
 * starting point. Without this every page computed from the static
 * DEFAULT_DRIVER_VALUES table and none of the collected signals reached the UI.
 */
function useNewsBaseline() {
  const loadNewsBaseline = useTrajectoryStore(s => s.loadNewsBaseline);
  const { data } = useQuery<{ driverValues: Record<DriverId, number>; signalCount: number; asOf: number | null }>({
    queryKey: ["/api/probabilities"],
    refetchInterval: 5 * 60_000,
  });
  useEffect(() => {
    if (data?.driverValues) {
      loadNewsBaseline(data.driverValues, { asOf: data.asOf, signalCount: data.signalCount });
    }
  }, [data, loadNewsBaseline]);
}

function AppRouter() {
  const [navOpen, setNavOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { resetDrivers } = useTrajectoryStore();
  const { toggle: toggleTheme } = useTheme();

  useUrlStateHydration();
  useNewsBaseline();

  useKeyboardShortcuts({
    onOpenHelp: () => setShowShortcuts(v => !v),
    onFocusSignalInput: () => {
      // Signals page mounts the input with id="input-signal-title"
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('[data-testid="input-signal-title"]');
        el?.focus();
      }, 100);
    },
    onResetDrivers: () => resetDrivers(),
  });

  // 'd' key toggles theme — small standalone listener (not part of the main shortcut set
  // because it fires from the theme context, which lives above the router)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "d") toggleTheme();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleTheme]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onShowShortcuts={() => setShowShortcuts(true)}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader
          onOpen={() => setNavOpen(true)}
          onShowShortcuts={() => setShowShortcuts(true)}
        />
        <main className="flex-1 min-w-0">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/signals" component={Signals} />
            <Route path="/external" component={External} />
            <Route path="/calibration" component={Calibration} />
            <Route path="/model-releases" component={ModelReleases} />
            <Route path="/assumptions" component={Assumptions} />
            <Route path="/watchlist" component={Watchlist} />
            <Route path="/portfolio" component={Portfolio} />
            <Route path="/decisions" component={Decisions} />
            <Route path="/sources" component={Sources} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
      {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
