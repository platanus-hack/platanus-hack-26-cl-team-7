/** Which attacker's report is open. The report view reads this; the Investigate button writes it. */
import { create } from "zustand";

interface ReportsState {
  ip: string | null;
  open: (ip: string) => void;
  close: () => void;
}

export const useReports = create<ReportsState>((set) => ({
  ip: null,
  open: (ip) => set({ ip }),
  close: () => set({ ip: null }),
}));
