import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initBrowserPolyfills } from "./lib/browser-polyfills";

// Initialize polyfills immediately on client
if (typeof window !== "undefined") {
  initBrowserPolyfills();
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm lazy route chunks when a visitor points to or touches an internal link,
    // so navigation does not wait until the click to start downloading the next page.
    defaultPreload: "intent",
    // Keep the warmed route fresh briefly instead of immediately discarding it.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
