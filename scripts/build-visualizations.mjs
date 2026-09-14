import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const runtime = NodePath.join(root, "packages/client-runtime");
const require = NodeModule.createRequire(NodePath.join(runtime, "package.json"));
const { build } = require("esbuild");
const destinations = ["apps/web/public/visualizations", "apps/mobile/assets/visualizations"];
const formats = ["mermaid", "plantuml", "dot", "vega"];

async function modifiedAt(file) {
  try {
    return (await NodeFSP.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

if (process.argv.includes("--if-needed")) {
  const sourceDirectory = NodePath.join(runtime, "src/visualizations");
  const sources = (await NodeFSP.readdir(sourceDirectory, { recursive: true }))
    .filter((file) => /\.(?:ts|mjs)$/.test(file))
    .map((file) => NodePath.join(sourceDirectory, file));
  sources.push(
    NodeURL.fileURLToPath(import.meta.url),
    NodePath.join(root, "pnpm-lock.yaml"),
    NodePath.join(runtime, "package.json"),
  );
  const newestSource = Math.max(...(await Promise.all(sources.map(modifiedAt))));
  const oldestAsset = Math.min(
    ...(await Promise.all(
      destinations.flatMap((directory) =>
        formats.map((format) => modifiedAt(NodePath.join(root, directory, `${format}.html`))),
      ),
    )),
  );
  if (oldestAsset >= newestSource) process.exit(0);
}

function inlineScript(source) {
  return source.replace(/\r\n?/g, "\n").replace(/<\/script/gi, "<\\/script");
}

for (const format of formats) {
  const result = await build({
    stdin: {
      contents: `import {renderDiagram} from './${format}.ts'; import {installVisualizationRuntime} from './runtime.ts'; installVisualizationRuntime(renderDiagram);`,
      resolveDir: NodePath.join(runtime, "src/visualizations/renderer"),
      sourcefile: `${format}-entry.ts`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const scripts = [];
  if (format === "plantuml") {
    scripts.push(
      inlineScript(await NodeFSP.readFile(require.resolve("@plantuml/core/viz-global.js"), "utf8")),
    );
  }
  scripts.push(inlineScript(result.outputFiles[0].text));
  const hashes = scripts
    .map((script) => `'sha256-${NodeCrypto.createHash("sha256").update(script).digest("base64")}'`)
    .join(" ");
  const csp = `default-src 'none'; script-src ${hashes} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Arial,sans-serif}#diagram{width:100%;height:100%;transform-origin:center center;display:flex;align-items:center;justify-content:center}#diagram>svg,#diagram>.vega-embed{max-width:100%;max-height:100%;height:auto}#diagram svg{display:block}#diagram:focus-visible{outline:2px solid #5881e5;outline-offset:-2px}</style></head><body><div id="diagram" tabindex="0" role="img" aria-label="Diagram. Use arrow keys to pan, plus or minus to zoom, and zero to fit."></div>${scripts.map((script) => `<script>${script}</script>`).join("")}</body></html>`;
  for (const destination of destinations) {
    const directory = NodePath.join(root, destination);
    await NodeFSP.mkdir(directory, { recursive: true });
    const destinationPath = NodePath.join(directory, `${format}.html`);
    const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
    await NodeFSP.writeFile(temporaryPath, html);
    await NodeFSP.rename(temporaryPath, destinationPath);
  }
  console.log(
    `Built ${format} visualization asset (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB).`,
  );
}
