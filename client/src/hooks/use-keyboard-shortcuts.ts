import { useEffect } from "react";
import { useLocation } from "wouter";
import { useTrajectoryStore } from "@/lib/store";

type Handler = (e: KeyboardEvent) => void;

interface Options {
  onFocusSignalInput?: () => void;
  onOpenHelp?: () => void;
  onResetDrivers?: () => void;
}

/**
 * Global keyboard shortcuts:
 *   /   → focus signal title input on the Signals page (or navigate there)
 *   1   → Dashboard
 *   2   → Signals
 *   3   → External
 *   4   → Calibration
 *   5   → Model Releases
 *   ?   → Open shortcuts help
 *   r   → Reset drivers (with confirm dialog handled elsewhere)
 *   d   → Toggle dark/light
 *
 * Shortcuts are disabled while typing in an input, textarea, or contenteditable.
 */
export function useKeyboardShortcuts({ onFocusSignalInput, onOpenHelp, onResetDrivers }: Options = {}) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handler: Handler = e => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target as HTMLElement).isContentEditable;

      // Undo/redo: Ctrl+Z / Ctrl+Shift+Z (or Cmd+Z on Mac). Allowed even in editable fields
      // so users can rewind driver adjustments while, e.g., a signal input is focused.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (editable && (tag === "INPUT" || tag === "TEXTAREA")) {
          // Don't hijack undo in real text inputs
          return;
        }
        e.preventDefault();
        const store = useTrajectoryStore.getState();
        if (e.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }

      // Allow "/" and "?" to work even in text fields is annoying — skip if editable
      if (editable) return;
      // Skip if modifier keys except shift for '?'
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          setLocation("/signals");
          setTimeout(() => onFocusSignalInput?.(), 50);
          break;
        case "1":
          setLocation("/");
          break;
        case "2":
          setLocation("/signals");
          break;
        case "3":
          setLocation("/external");
          break;
        case "4":
          setLocation("/calibration");
          break;
        case "5":
          setLocation("/model-releases");
          break;
        case "6":
          setLocation("/assumptions");
          break;
        case "7":
          setLocation("/watchlist");
          break;
        case "8":
          setLocation("/portfolio");
          break;
        case "9":
          setLocation("/decisions");
          break;
        case "0":
          setLocation("/sources");
          break;
        case "?":
          onOpenHelp?.();
          break;
        case "r":
          onResetDrivers?.();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onFocusSignalInput, onOpenHelp, onResetDrivers, setLocation]);
}
