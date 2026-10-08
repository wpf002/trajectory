import express, { type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "node:http";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

/** Longest response body echoed into a log line. Full /api/signals bodies ran to ~300KB a request. */
const LOG_BODY_CHARS = 200;

/**
 * Express app with the API mounted and the error handler last. No Vite, no
 * static files, no listen — index.ts adds those, and tests use this directly.
 */
export async function createApp(opts: { requestLog?: boolean } = {}): Promise<{ app: express.Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));

  if (opts.requestLog !== false) {
    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let body: unknown;
      const originalJson = res.json;
      res.json = function (b, ...args) {
        body = b;
        return originalJson.apply(res, [b, ...args]);
      };
      res.on("finish", () => {
        if (!path.startsWith("/api")) return;
        let line = `${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`;
        if (body !== undefined) {
          const s = JSON.stringify(body);
          line += ` :: ${s.length > LOG_BODY_CHARS ? s.slice(0, LOG_BODY_CHARS) + "…" : s}`;
        }
        log(line);
      });
      next();
    });
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    // Seven routes parse req.body with zod outside a try. Express 5 forwards the
    // throw here, where it used to become a 500 carrying the raw ZodError text.
    if (err instanceof ZodError) {
      return res.status(400).json({
        message: "Invalid request",
        issues: err.issues.map(i => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error("Internal Server Error:", err);
    return res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  return { app, httpServer };
}
