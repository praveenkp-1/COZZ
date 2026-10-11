import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from "@tanstack/react-query";
import App from "./App";
import "./styles/global.css";
import "./styles/homepage.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const data = document.getElementById("cozzy-data");
const state = data
  ? (JSON.parse(data.textContent ?? "{}") as DehydratedState)
  : undefined;
const app = (
  <QueryClientProvider client={queryClient}>
    <HydrationBoundary state={state}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HydrationBoundary>
  </QueryClientProvider>
);
const root = document.getElementById("root")!;
root.hasChildNodes() ? hydrateRoot(root, app) : createRoot(root).render(app);
