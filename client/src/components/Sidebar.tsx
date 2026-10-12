import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Radio,
  LineChart,
  GaugeCircle,
  Menu,
  X,
  Keyboard,
  ClipboardCheck,
  Wallet,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { WatchlistItem } from "@shared/schema";
import { PRESETS, computeScenarioProbabilities } from "../../../shared/model";
import { useTrajectoryStore } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { PresetPreviewButton } from "@/components/PresetPreviewButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";

const NAV = [
  { href: "/", label: "Dashboard", icon: GaugeCircle },
  { href: "/signals", label: "Signals", icon: Radio },
  { href: "/calibration", label: "Calibration", icon: LineChart },
  { href: "/assumptions", label: "Assumptions", icon: ClipboardCheck },
  { href: "/plan", label: "Plan", icon: Wallet },
];

function TrajectoryLogo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="Trajectory Logo">
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
        className="p-2 -ml-2 rounded-md hover:bg-sidebar-accent/50 transition-colors"
        data-testid="button-open-nav"
        aria-label="Open Navigation"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <TrajectoryLogo className="w-5 h-5 text-sidebar-primary" />
        <div className="font-display text-xl leading-none">Trajectory</div>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        {onShowShortcuts && (
          <button
            onClick={onShowShortcuts}
            className="p-2 rounded-md hover:bg-sidebar-accent/50 transition-colors"
            aria-label="Keyboard Shortcuts"
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
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const [location] = useLocation();
  const {
    applyPresetValues,
    driverValues,
    correlationsEnabled,
    setCorrelationsEnabled,
    correlationStrength,
    setCorrelationStrength,
  } = useTrajectoryStore();
  // Alerts crossed by the news forecast (not by a what-if on the sliders).
  const newsBaseline = useTrajectoryStore(st => st.newsBaseline);
  const { data: alerts = [] } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const crossedCount = (() => {
    if (!newsBaseline || alerts.length === 0) return 0;
    const p = Object.fromEntries(computeScenarioProbabilities(newsBaseline).map(x => [x.id, x.probability * 100]));
    return alerts.filter(a => a.op === "gt" ? p[a.scenarioId] >= a.thresholdPct : p[a.scenarioId] <= a.thresholdPct).length;
  })();
  const { toast } = useToast();

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
          <div className="flex items-center gap-3">
            <TrajectoryLogo className="w-7 h-7 text-sidebar-primary" />
            <div className="font-display text-xl leading-none">Trajectory</div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle className="hidden lg:inline-flex" />
            <button
              onClick={onClose}
              className="lg:hidden p-2 -mr-2 rounded-md hover:bg-sidebar-accent/50 transition-colors"
              data-testid="button-close-nav"
              aria-label="Close Navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="p-2 space-y-1">
          {NAV.map(item => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                  }`}
                  data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/plan" && crossedCount > 0 && (
                    <span className="text-[11px] font-mono tabular-nums px-2 rounded-full bg-accent text-accent-foreground" title={`${crossedCount} alert${crossedCount === 1 ? "" : "s"} crossed`}>
                      {crossedCount}
                    </span>
                  )}
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
            <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60 font-mono mb-2">Model</div>
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
                  <span className="text-[11px] text-sidebar-foreground/70">Strength</span>
                  <span className="text-[11px] font-mono text-sidebar-primary">{(correlationStrength * 100).toFixed(0)}%</span>
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
            <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60 font-mono mb-2">Presets</div>
            <div className="space-y-1">
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

        </div>

      </aside>

    </>
  );
}
