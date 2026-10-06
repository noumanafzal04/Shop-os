import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "flatpickr/dist/flatpickr.css";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { UiModeProvider } from "./context/UiModeContext.tsx";
import { ToastProvider } from "./components/ui/toast";
import { ConfirmProvider } from "./components/ui/confirm";
import { queryClient } from "./common/api/queryClient.ts";
import { bootTheme } from "./common/theme/rememberedTheme.ts";

// BEFORE the first paint: the shop's own colours and dark mode, as this
// device last saw them. Without it every reload opened in the house blue and
// changed a moment later, when the shop's settings arrived.
bootTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UiModeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AppWrapper>
                <App />
              </AppWrapper>
            </ConfirmProvider>
          </ToastProvider>
        </UiModeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
