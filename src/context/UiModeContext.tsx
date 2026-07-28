import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";

/**
 * Basic vs Advanced UI density. Basic trims the shop sidebar to the daily
 * essentials and shows a lean dashboard — the calm default for a new merchant;
 * Advanced reveals every module and metric. Per-device, remembered in
 * localStorage. Only meaningful on the shop side (the admin console ignores it).
 */
export type UiMode = "basic" | "advanced";

type UiModeContextType = {
  mode: UiMode;
  setMode: (m: UiMode) => void;
  toggleMode: () => void;
};

const STORAGE_KEY = "ui_mode";

const UiModeContext = createContext<UiModeContextType | undefined>(undefined);

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<UiMode>("basic");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as UiMode | null;
    if (saved === "basic" || saved === "advanced") setModeState(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, mode);
  }, [mode, ready]);

  const setMode = (m: UiMode) => setModeState(m);
  const toggleMode = () => setModeState((m) => (m === "basic" ? "advanced" : "basic"));

  return (
    <UiModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </UiModeContext.Provider>
  );
};

export const useUiMode = () => {
  const context = useContext(UiModeContext);
  if (context === undefined) {
    throw new Error("useUiMode must be used within a UiModeProvider");
  }
  return context;
};
