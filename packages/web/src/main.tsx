import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./styles/global.css";
import { registerAllChartTypes } from "./components/charts/definitions";

registerAllChartTypes();

const root = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
