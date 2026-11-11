import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initBrowserPolyfills } from "./lib/browser-polyfills";

// Initialize polyfills immediately on client
if (typeof window !== "undefined") {
  initBrowserPolyfills();
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes fresh in client memory
        gcTime: 1000 * 60 * 60 * 24, // 24 hours in client garbage collector
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm lazy route chunks when a visitor points to or touches an internal link
    defaultPreload: "intent",
    // Keep warmed routes fresh in client memory for 10 minutes
    defaultPreloadStaleTime: 1000 * 60 * 10,
    defaultPreloadDelay: 50,
  });

  return router;
};
