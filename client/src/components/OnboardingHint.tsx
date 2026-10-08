import { useState } from "react";
import { X, Sparkles } from "lucide-react";

/**
 * First-time visitor hint banner. Ephemeral (React state only — no localStorage
 * because it's blocked in the sandbox iframe). Dismisses for the current session.
 * A daily task can also surface a "new signals available" hint by wrapping this.
 */
export function OnboardingHint() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div
      className="mb-3 p-3 rounded-lg border border-accent/30 bg-accent/5 flex items-start gap-3"
      data-testid="onboarding-hint"
    >
      <Sparkles className="w-4 h-4 text-accent shrink-0 mt-1" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium mb-1">Welcome to Trajectory</div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          Drag <span className="text-foreground/80">drivers</span> on the left to see how they
          shift <span className="text-foreground/80">scenario probabilities</span>. Add news{" "}
          <span className="text-foreground/80">signals</span> to update the model. Try{" "}
          <kbd className="px-1 py-1 rounded bg-muted/60 border border-border font-mono text-[11px]">?</kbd>{" "}
          for keyboard shortcuts.
        </div>
      </div>
      <button
        onClick={() => setVisible(false)}
        className="text-muted-foreground hover:text-foreground p-1 rounded"
        data-testid="button-dismiss-onboarding"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Keyboard shortcut help panel — inline card. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const shortcuts: [string, string][] = [
    ["1", "Dashboard"],
    ["2", "Signals"],
    ["3", "External Forecasts"],
    ["4", "Calibration"],
    ["5", "Model Releases"],
    ["6", "Assumptions"],
    ["7", "Watchlist"],
    ["8", "Portfolio"],
    ["9", "Decisions"],
    ["0", "Sources"],
    ["/", "Add new signal"],
    ["r", "Reset drivers to baseline"],
    ["d", "Toggle dark/light mode"],
    ["⌘ Z", "Undo driver change"],
    ["⇧ ⌘ Z", "Redo driver change"],
    ["?", "Show this panel"],
  ];
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="shortcut-help-overlay"
    >
      <div
        className="max-w-sm w-full bg-card border border-border rounded-lg p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Keyboard shortcuts</div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            data-testid="button-close-shortcut-help"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between text-xs py-1">
              <span className="text-foreground/80">{label}</span>
              <kbd className="px-2 py-1 rounded bg-muted/60 border border-border font-mono text-[11px]">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
