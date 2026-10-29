#!/bin/bash
cd "$(dirname "$0")/../../.." && /opt/npm-tools/node_modules/.bin/esbuild docs/package4-m2/e2e/client.tsx --bundle --outfile=docs/package4-m2/e2e/out.js --alias:@=$PWD/src --alias:dexie=$PWD/docs/package4-m2/e2e/dexie-shim.ts --alias:@tanstack/react-query=$PWD/docs/package4-m2/e2e/rq-shim.ts --jsx=automatic --define:process.env.NODE_ENV='"development"' --log-level=error
