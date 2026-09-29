import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { AppShell } from "@/components/AppShell";
import { ErrorFallback } from "@/components/ErrorFallback";
import App from "./app";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      basename 用 Vite 内建常量，不再使用平台预设注入的 process.env.CLIENT_BASE_PATH：
      浏览器环境中没有 `process` 这个全局对象，移除平台预设后继续引用会在启动时直接抛错。
      BASE_URL 由 Vite 在构建期注入（本站部署在域名根路径，取值为 "/"）。
    */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />
        )}
      >
        <AppShell>
          <App />
        </AppShell>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
