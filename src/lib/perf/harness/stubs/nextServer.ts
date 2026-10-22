// Test stub for `next/server` — only what the routes use at runtime.
export const NextResponse = {
  json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
}
export type NextRequest = Request
