import { X } from "lucide-react";

/** Keyboard shortcut help panel — inline card. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const shortcuts: [string, string][] = [
    ["1", "Dashboard"],
    ["2", "Signals"],
    ["3", "Calibration"],
    ["4", "Assumptions"],
    ["5", "Plan"],
    ["/", "New Signal"],
    ["r", "Reset Drivers"],
    ["d", "Dark / Light"],
    ["⌘ Z", "Undo"],
    ["⇧ ⌘ Z", "Redo"],
    ["?", "Shortcuts"],
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
          <div className="text-sm font-medium">Keyboard Shortcuts</div>
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
