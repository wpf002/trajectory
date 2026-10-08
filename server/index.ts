import "dotenv/config";
import { createApp, log } from "./app";
import { serveStatic } from "./static";

export { log };

(async () => {
  const { app, httpServer } = await createApp();

  // Vite / static go after the API so the SPA catch-all can't shadow it.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      // SO_REUSEPORT is unsupported on macOS sockets (ENOTSUP) — Linux only.
      reusePort: process.platform === "linux",
    },
    () => {
      log(`serving on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    },
  );
})();
