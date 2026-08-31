import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Radio,
  Globe2,
  LineChart,
  GaugeCircle,
  RotateCcw,
  Menu,
  X,
  Keyboard,
  Download,
  Share2,
  Cpu,
  ClipboardCheck,
  Bell,
  Wallet,
  BookOpen,
  Database,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PRESETS } from "../../../shared/model";
import { useTrajectoryStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PresetPreviewButton } from "@/components/PresetPreviewButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";

const NAV = [
  { href: "/", label: "Dashboard", icon: GaugeCircle, shortcut: "1" },
  { href: "/signals", label: "Signals", icon: Radio, shortcut: "2" },
  { href: "/external", label: "External Forecasts", icon: Globe2, shortcut: "3" },
  { href: "/calibration", label: "Calibration", icon: LineChart, shortcut: "4" },
  { href: "/model-releases", label: "Model Releases", icon: Cpu, shortcut: "5" },
  { href: "/assumptions", label: "Assumptions", icon: ClipboardCheck, shortcut: "6" },
  { href: "/watchlist", label: "Watchlist", icon: Bell, shortcut: "7" },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, shortcut: "8" },
  { href: "/decisions", label: "Decisions", icon: BookOpen, shortcut: "9" },
  { href: "/sources", label: "Sources", icon: Database, shortcut: "0" },
];

function TrajectoryLogo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="Trajectory logo">
      <path d="M4 26 L12 18 L18 22 L28 8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="26" r="1.5" fill="currentColor" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" />
      <circle cx="18" cy="22" r="1.5" fill="currentColor" />
      <circle cx="28" cy="8" r="1.5" fill="currentColor" />
      <path d="M24 8 L28 8 L28 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MobileHeader({ onOpen, onShowShortcuts }: { onOpen: () => void; onShowShortcuts?: () => void }) {
  const [location] = useLocation();
  const currentNav = NAV.find(n => n.href === location) ?? NAV[0];

  return (
    <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between h-14 px-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
      <button
        onClick={onOpen}
        className="p-1.5 -ml-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors"
        data-testid="button-open-nav"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <TrajectoryLogo className="w-5 h-5 text-sidebar-primary" />
        <div className="text-xs font-semibold tracking-tight">TRAJECTORY</div>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        {onShowShortcuts && (
          <button
            onClick={onShowShortcuts}
            className="p-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
}

export function Sidebar({ open, onClose, onShowShortcuts }: SidebarProps) {
  const [location] = useLocation();
  const {
    resetDrivers,
    applyPresetValues,
    driverValues,
    correlationsEnabled,
    setCorrelationsEnabled,
    correlationStrength,
    setCorrelationStrength,
  } = useTrajectoryStore();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetScope, setResetScope] = useState<"drivers" | "signals" | "history" | "all">("drivers");
  const qc = useQueryClient();
  const { toast } = useToast();

  const resetMutation = useMutation({
    mutationFn: async (scope: "signals" | "history" | "all") => {
      await apiRequest("POST", "/api/reset", { scope });
    },
    onSuccess: (_, scope) => {
      qc.invalidateQueries({ queryKey: ["/api/signals"] });
      qc.invalidateQueries({ queryKey: ["/api/forecast-history"] });
      toast({ title: "Reset applied", description: `Cleared ${scope}.` });
    },
  });

  // Close drawer on route change (mobile)
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Lock body scroll when open on mobile
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleReset() {
    if (resetScope === "drivers") {
      resetDrivers();
      toast({ title: "Drivers reset", description: "Restored to real-world baseline (mid-2026)." });
    } else if (resetScope === "all") {
      resetDrivers();
      resetMutation.mutate("all");
    } else {
      resetMutation.mutate(resetScope);
    }
    setResetDialogOpen(false);
  }

  function handleExport() {
    const payload = {
      exported: new Date().toISOString(),
      driverValues,
      correlationsEnabled,
      correlationStrength,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trajectory-state-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "State exported", description: "JSON downloaded to your device." });
  }

  function handleShare() {
    const compact: Record<string, string> = {};
    for (const [k, v] of Object.entries(driverValues)) {
      compact[k] = Math.round(v * 100).toString();
    }
    const query = new URLSearchParams(compact).toString();
    const url = `${window.location.origin}${window.location.pathname}#/?${query}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Share link copied", description: "URL contains your current driver state." });
    });
  }

  return (
    <>
      {/* Backdrop (mobile only when open) */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 animate-in fade-in"
          onClick={onClose}
          data-testid="nav-backdrop"
        />
      )}

      {/* Sidebar — drawer on mobile, static column on desktop */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 h-screen
          bg-sidebar text-sidebar-foreground border-r border-sidebar-border
          flex flex-col
          transform transition-transform duration-200 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:static lg:translate-x-0 lg:w-64 lg:shrink-0 lg:sticky lg:top-0
          overflow-y-auto
        `}
      >
        {/* Logo + close button */}
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TrajectoryLogo className="w-7 h-7 text-sidebar-primary" />
            <div>
              <div className="font-semibold text-sm tracking-tight">TRAJECTORY</div>
              <div className="text-[10px] font-mono tracking-widest text-sidebar-foreground/60 -mt-0.5">FORECAST ENGINE</div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle className="hidden lg:inline-flex" />
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 -mr-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors"
              data-testid="button-close-nav"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="p-2 space-y-0.5">
          {NAV.map(item => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                  }`}
                  data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{item.label}</span>
                  <kbd className="hidden lg:inline-block px-1 py-0 text-[9px] font-mono rounded bg-sidebar-accent/30 text-sidebar-foreground/50">
                    {item.shortcut}
                  </kbd>
                  {active && <div className="w-1 h-4 bg-sidebar-primary rounded-full" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <Separator className="bg-sidebar-border" />

        {/* Model controls */}
        <div className="p-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60 font-mono mb-2">Model</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label htmlFor="correlations-toggle" className="text-xs">Correlations</label>
              <Switch
                id="correlations-toggle"
                checked={correlationsEnabled}
                onCheckedChange={setCorrelationsEnabled}
                data-testid="switch-correlations"
              />
            </div>
            {correlationsEnabled && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-sidebar-foreground/70">Strength</span>
                  <span className="text-[10px] font-mono text-sidebar-primary">{(correlationStrength * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[correlationStrength]}
                  onValueChange={([v]) => setCorrelationStrength(v)}
                  min={0}
                  max={1}
                  step={0.05}
                  data-testid="slider-correlation-strength"
                />
              </div>
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60 font-mono mb-2">Presets</div>
            <div className="space-y-0.5">
              {PRESETS.map(p => (
                <PresetPreviewButton
                  key={p.id}
                  preset={p}
                  onApply={() => {
                    applyPresetValues(p.values);
                    toast({ title: `Applied: ${p.name}`, description: p.description });
                  }}
                  currentValues={driverValues}
                />
              ))}
            </div>
          </div>

          <Separator className="bg-sidebar-border" />

          {/* Export / Share */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60 font-mono mb-2">Share</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={handleExport}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs hover:bg-sidebar-accent/50 transition-colors"
                data-testid="button-export-state"
                title="Download current state as JSON"
              >
                <Download className="w-3 h-3" /> Export
              </button>
              <button
                onClick={handleShare}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs hover:bg-sidebar-accent/50 transition-colors"
                data-testid="button-share-state"
                title="Copy shareable URL"
              >
                <Share2 className="w-3 h-3" /> Link
              </button>
            </div>
          </div>
        </div>

        <div className="mt-auto p-3 border-t border-sidebar-border space-y-2">
          <Button
            onClick={() => setResetDialogOpen(true)}
            variant="ghost"
            size="sm"
            className="w-full text-xs justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            data-testid="button-reset-drivers"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset...
          </Button>
          {onShowShortcuts && (
            <button
              onClick={onShowShortcuts}
              className="hidden lg:flex items-center gap-1.5 w-full px-2 py-1 rounded text-[10px] font-mono text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/30 transition-colors"
              data-testid="button-show-shortcuts"
            >
              <Keyboard className="w-3 h-3" /> Shortcuts (?)
            </button>
          )}
          <div className="text-[10px] font-mono text-sidebar-foreground/40 flex items-center gap-1">
            <Activity className="w-2.5 h-2.5" />
            <span>v1.1 · {new Date().getFullYear()}</span>
          </div>
        </div>
      </aside>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent data-testid="dialog-reset">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset scope</AlertDialogTitle>
            <AlertDialogDescription>
              Choose what to reset. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            {[
              { id: "drivers" as const, label: "Drivers only", desc: "Restore sliders to real-world 2026 baseline." },
              { id: "signals" as const, label: "Signal history", desc: "Delete all ingested signals from the database." },
              { id: "history" as const, label: "Forecast snapshots", desc: "Clear daily probability history (calibration chart)." },
              { id: "all" as const, label: "Everything", desc: "Reset drivers + delete signals + clear history." },
            ].map(opt => (
              <label
                key={opt.id}
                className={`flex items-start gap-2 p-2.5 rounded-md border cursor-pointer transition-colors ${
                  resetScope === opt.id
                    ? "border-accent bg-accent/5"
                    : "border-border hover:bg-muted/50"
                }`}
                data-testid={`reset-scope-${opt.id}`}
              >
                <input
                  type="radio"
                  name="reset-scope"
                  value={opt.id}
                  checked={resetScope === opt.id}
                  onChange={() => setResetScope(opt.id)}
                  className="mt-0.5 accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} data-testid="button-confirm-reset">
              Reset {resetScope}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
