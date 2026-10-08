import { create } from "zustand";
import { DEFAULT_DRIVER_VALUES, applyCorrelations, computeScenarioProbabilities, forecastMilestones, squash, DriverId } from "../../../shared/model";

interface TrajectoryStore {
  driverValues: Record<DriverId, number>;
  /**
   * Driver values derived from collected news by the server (/api/probabilities).
   * This is the forecast; driverValues is that plus whatever what-if adjustments
   * the user has made. Null until the first load, when the static defaults stand in.
   */
  newsBaseline: Record<DriverId, number> | null;
  newsBaselineMeta: { asOf: number | null; signalCount: number } | null;
  loadNewsBaseline: (values: Record<DriverId, number>, meta: { asOf: number | null; signalCount: number }) => void;
  correlationsEnabled: boolean;
  correlationStrength: number; // 0-1
  // Assumption disagreements: key = `${scenarioId}:${assumptionKey}`, value = note
  disagreements: Record<string, string>;
  // B7: time-decay half-life in days for signal impact freshness
  decayHalfLifeDays: number;
  // G28: undo/redo history for driver adjustments
  history: Record<DriverId, number>[];
  future: Record<DriverId, number>[];
  setDecayHalfLifeDays: (v: number) => void;
  setDriverValue: (id: DriverId, value: number) => void;
  resetDrivers: () => void;
  setCorrelationsEnabled: (v: boolean) => void;
  setCorrelationStrength: (v: number) => void;
  applyPresetValues: (values: Partial<Record<DriverId, number>>) => void;
  applySignalImpact: (impacts: Record<string, number>) => void;
  toggleDisagreement: (scenarioId: string, assumptionKey: string, note?: string) => void;
  setDisagreementNote: (scenarioId: string, assumptionKey: string, note: string) => void;
  clearDisagreements: () => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 50;

export const useTrajectoryStore = create<TrajectoryStore>((set, get) => ({
  driverValues: { ...DEFAULT_DRIVER_VALUES },
  newsBaseline: null,
  newsBaselineMeta: null,
  loadNewsBaseline: (values, meta) => {
    const state = get();
    // Adopt the news forecast as the starting point unless the user has already
    // started a what-if — never yank sliders out from under them on a refetch.
    const untouched = state.history.length === 0;
    set({
      newsBaseline: { ...values },
      newsBaselineMeta: meta,
      ...(untouched ? { driverValues: { ...values } } : {}),
    });
  },
  correlationsEnabled: true,
  correlationStrength: 0.35,
  disagreements: {},
  decayHalfLifeDays: 30,
  history: [],
  future: [],
  setDecayHalfLifeDays: (v) => set({ decayHalfLifeDays: v }),
  setDriverValue: (id, value) => {
    const state = get();
    const newValues = state.correlationsEnabled
      ? applyCorrelations(id, value, state.driverValues, state.correlationStrength)
      : { ...state.driverValues, [id]: value };
    const newHistory = [...state.history, state.driverValues].slice(-MAX_HISTORY);
    set({ driverValues: newValues, history: newHistory, future: [] });
  },
  resetDrivers: () => set(state => ({
    driverValues: { ...(state.newsBaseline ?? DEFAULT_DRIVER_VALUES) },
    history: [...state.history, state.driverValues].slice(-MAX_HISTORY),
    future: [],
  })),
  setCorrelationsEnabled: (v) => set({ correlationsEnabled: v }),
  setCorrelationStrength: (v) => set({ correlationStrength: v }),
  applyPresetValues: (values) => {
    set(state => ({
      driverValues: { ...state.driverValues, ...values } as Record<DriverId, number>,
      history: [...state.history, state.driverValues].slice(-MAX_HISTORY),
      future: [],
    }));
  },
  applySignalImpact: (impacts) => {
    set(state => {
      const newValues = { ...state.driverValues };
      for (const [driver, delta] of Object.entries(impacts)) {
        const d = driver as DriverId;
        if (d in newValues && Number.isFinite(delta)) {
          // Same log-odds nudge the server's fold uses, so a signal moves the
          // dashboard by what it moves the forecast.
          newValues[d] = squash(newValues[d], delta);
        }
      }
      return {
        driverValues: newValues,
        history: [...state.history, state.driverValues].slice(-MAX_HISTORY),
        future: [],
      };
    });
  },
  undo: () => {
    const state = get();
    if (state.history.length === 0) return false;
    const prev = state.history[state.history.length - 1];
    set({
      driverValues: prev,
      history: state.history.slice(0, -1),
      future: [state.driverValues, ...state.future].slice(0, MAX_HISTORY),
    });
    return true;
  },
  redo: () => {
    const state = get();
    if (state.future.length === 0) return false;
    const next = state.future[0];
    set({
      driverValues: next,
      history: [...state.history, state.driverValues].slice(-MAX_HISTORY),
      future: state.future.slice(1),
    });
    return true;
  },
  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,
  toggleDisagreement: (scenarioId, assumptionKey, note = "") => {
    const key = `${scenarioId}:${assumptionKey}`;
    set(state => {
      const next = { ...state.disagreements };
      if (key in next) {
        delete next[key];
      } else {
        next[key] = note;
      }
      return { disagreements: next };
    });
  },
  setDisagreementNote: (scenarioId, assumptionKey, note) => {
    const key = `${scenarioId}:${assumptionKey}`;
    set(state => ({ disagreements: { ...state.disagreements, [key]: note } }));
  },
  clearDisagreements: () => set({ disagreements: {} }),
}));

export { computeScenarioProbabilities, forecastMilestones };
