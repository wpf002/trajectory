import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// shared/ is bundled into the browser. A bare `process.env` there type-checks
// and passes every server test, then throws "process is not defined" on load
// and blanks the whole app — which is exactly what happened once.
test("shared/ modules do not touch Node-only globals", () => {
  const dir = join(process.cwd(), "shared");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8")
      .split("\n")
      .filter(line => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    for (const banned of ["process.", "require(", "__dirname", "Buffer."]) {
      assert.ok(!src.includes(banned), `shared/${f} references ${banned}`);
    }
  }
});
