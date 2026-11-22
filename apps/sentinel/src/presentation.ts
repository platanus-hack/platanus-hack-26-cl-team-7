import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

const prefix = "/presentacion";
const asset = /^(?:(?:assets|fonts|img)\/[\w./-]+\.(?:css|js|woff2|avif|webp|jpg|png|svg)|pitch\.(?:html|pdf)|(?:logo|favicon)\.svg|share\.jpg)$/;

export function mountPresentation(app: Hono, directory: string) {
  app.get(prefix, (c) => c.redirect(prefix + "/"));
  app.get(prefix + "/", (c) => {
    c.header("Cache-Control", "no-cache");
    const page = readFileSync(join(directory, "index.html"), "utf8");
    return c.html(page.replaceAll('href="#contact">Probar el panel', 'href="/">Abrir el panel'));
  });
  app.get(prefix + "/pitch", (c) => c.redirect(prefix + "/pitch.html"));
  const files = serveStatic({ root: directory, rewriteRequestPath: (path) => path.slice(prefix.length) });
  app.get(prefix + "/*", (c, next) => {
    const path = c.req.path.slice(prefix.length + 1);
    if (!asset.test(path) || path.split("/").some((part) => part.startsWith("."))) return c.notFound();
    return files(c, next);
  }, (c) => c.notFound());
}
