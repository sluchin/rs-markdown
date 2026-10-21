/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { captureErrors, setupLog } from "./lib/log";
import App from "./ui/App";
import { sendLog } from "./ui/api";
import "./ui/App.css";

setupLog(import.meta.env.DEV, sendLog);
captureErrors(window);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
