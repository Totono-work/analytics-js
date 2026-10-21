import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
writeFileSync(new URL("src/version.ts", root), `// Generated from package.json by scripts/version.mjs.
export const SDK_VERSION = ${JSON.stringify(version)};
`);
