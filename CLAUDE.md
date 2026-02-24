---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

## File Editing with Hashline

Use `hashline` for all file edits. Never edit files without reading them first.

**Read a file:**
```bash
hashline read src/main.rs
```
Output includes `LINE:HASH` anchors (e.g., `1:a3|use std::io;`). For partial reads:
```bash
hashline read --start-line 10 --lines 20 src/main.rs
```

**Apply edits** (batch all edits to one file into a single call):
```bash
hashline apply << 'EOF'
{
  "path": "src/main.rs",
  "edits": [
    {"set_line": {"anchor": "4:01", "new_text": " println!(\"goodbye\");"}},
    {"insert_after": {"anchor": "5:0e", "text": "fn helper() {\n todo!()\n}"}}
  ]
}
EOF
```

Use `--emit-updated` to receive fresh anchors without re-reading.

**Edit operations:**
- `set_line`: Replace a single line using its anchor
- `replace_lines`: Replace a range; use empty `"new_text"` to delete
- `insert_after`: Add lines after an anchor
- `replace`: Substring replacement (runs after anchor operations; errors on ambiguity)

**Exit codes:** 0 = success, 1 = hash mismatch (stderr shows updated anchors—copy and retry), 2 = other errors.

**On mismatch:** stderr displays the file with `>>>` marking changed lines and updated `LINE:HASH` references. Update only the affected anchor and retry without re-reading the entire file.

**Rules:**
- Never edit files without first reading them with `hashline read`
- Batch all edits to one file into a single apply command
- Prefer anchor operations over substring replacement
- Never guess hashes—always read first

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
