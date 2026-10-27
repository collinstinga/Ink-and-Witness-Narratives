import type { Request, Response } from "express";
import { createApp } from "../server.js";

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  const routedPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (routedPath) {
    // Vercel prepopulates query; Express 4 deliberately does not reparse an
    // existing query object. Remove only our rewrite carrier, not user input.
    const { path: _routingPath, ...publicQuery } = req.query;
    req.query = publicQuery;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(publicQuery)) {
      if (Array.isArray(value)) value.forEach(item => query.append(key, String(item)));
      else if (value !== undefined) query.set(key, String(value));
    }
    req.url = `/api/${routedPath}${query.size ? `?${query.toString()}` : ''}`;
  }

  if (!appPromise) appPromise = createApp();
  const app = await appPromise;
  return app(req, res);
}
