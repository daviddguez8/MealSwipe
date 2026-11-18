// Builds MealSwipe.
//   node build.mjs        -> index.html + dist/artifact.html (data stays in this browser)
//   node build.mjs web    -> dist-web/index.html for Vercel (shared household on Supabase)
//                            needs SUPABASE_URL and SUPABASE_ANON_KEY in the environment
import * as esbuild from "esbuild";
import fs from "fs";
import { execSync } from "child_process";

const web = process.argv[2] === "web";
fs.mkdirSync("dist", { recursive: true });
execSync("npx tailwindcss -c tailwind.config.cjs -i src/tw.css -o dist/tw.css --minify", { stdio: "inherit" });

// The local/Artifact build loads React from cdnjs; the web build bundles it.
const globals = { react: "React", "react-dom/client": "ReactDOM", "react-dom": "ReactDOM" };
const globalsPlugin = {
  name: "globals",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|react-dom\/client)$/ }, (a) => ({ path: a.path, namespace: "g" }));
    b.onLoad({ filter: /.*/, namespace: "g" }, (a) => ({ contents: `module.exports = window.${globals[a.path]};`, loader: "js" }));
  },
};

if (web && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY to build the web version.");
  process.exit(1);
}

const r = await esbuild.build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  write: false,
  jsx: "transform",
  target: "es2019",
  legalComments: "none",
  plugins: web ? [] : [globalsPlugin],
  define: {
    __MS_BACKEND__: JSON.stringify(web ? "supabase" : "local"),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL || ""),
    __SUPABASE_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY || ""),
    "process.env.NODE_ENV": '"production"',
  },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
let fragment = fs
  .readFileSync("template.html", "utf8")
  .replace("/*__APP__*/", () => js)
  .replace("/*__TW__*/", () => fs.readFileSync("dist/tw.css", "utf8"));
if (web) fragment = fragment.replace(/<script src="https:\/\/cdnjs[^>]+><\/script>\n?/g, "");

const page = (body) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#f4f6f3">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8C%AE%3C/text%3E%3C/svg%3E">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

if (web) {
  fs.mkdirSync("dist-web", { recursive: true });
  fs.writeFileSync("dist-web/index.html", page(fragment));
  console.log("built web", (fragment.length / 1024).toFixed(1) + " KB");
} else {
  fs.writeFileSync("dist/artifact.html", fragment);
  fs.writeFileSync("index.html", page(fragment));
  console.log("built local", (fragment.length / 1024).toFixed(1) + " KB");
}
