import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { resolveLocale, setLocale } from "./i18n/index.ts";
import { loadSettings } from "./settings.ts";
import "./styles.css";

// The language first: settings resolved before it would name the default modes in Chinese.
setLocale(resolveLocale(loadSettings().language));

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
