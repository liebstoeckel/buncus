// Client entry for the widget iframe. Hydrates the React app from the URL config.

import { createRoot } from "react-dom/client";
import { readConfig } from "./config.ts";
import { App } from "./components/App.tsx";

const config = readConfig();
const root = document.getElementById("buncus-root");
if (root) createRoot(root).render(<App config={config} />);
