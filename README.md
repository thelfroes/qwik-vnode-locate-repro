# Qwik 2.0.0-beta.35 — `vnode_locate → Missing child` on event dispatch

## TL;DR

A root `component$` that returns `QwikRouterProvider` as its JSX root
(elementless host) and has a `useVisibleTask$` with
`strategy: 'document-ready'` causes Qwik to emit a consolidated task
registration `<script q-d:qinit q-d:qrouterpopstate q-d:qcinit>` element at
`<body>` level, with `q:p` pointing to a virtual vnode that is **not**
present in body's vnode-children chain.

When events are dispatched on that script (qinit at load time, or any
subsequent delegation), `vnode_locate` walks the DOM `parentElement` chain
(it does **not** consult `q:p`), stops at `<body>`, calls
`vnode_getVNodeForChildNode(bodyVNode, script)`, walks body's vnode
children, never finds the script, and asserts:

```
Internal assert, this is likely caused by a bug in Qwik: Missing child.
  at vnode_getVNodeForChildNode (core.mjs)
  at vnode_locate (core.mjs)
  at newInvokeContextFromDOM (core.mjs)
  at _run (core.mjs)
```

Every subsequent event re-fires the same assert, flooding the console
and leaving the page non-interactive.

## Versions

- `@qwik.dev/core` 2.0.0-beta.35
- `@qwik.dev/router` 2.0.0-beta.35
- Vite 7.3.1, Node 22

## Steps to reproduce

```bash
pnpm install
pnpm dev
```

1. Open the DevTools Console FIRST.
2. Open <http://localhost:5173/>. SSR is artificially delayed (~1.5s) by a
   `routeLoader$` in `src/routes/index.tsx` to widen the
   delivery-vs-resume window — without it the page is fast enough that
   `qinit` fires before any human click can land, masking the bug.
3. As soon as the button paints, click it. You should see a flood of
   "QWIK ERROR Internal assert ... Missing child" in the console.

If you can't land a click inside the window:

- Increase `SSR_LATENCY_MS` (top of `src/routes/index.tsx`).
- Increase `LEAVES` (same file) — each leaf is a child `component$` with
  its own `useVisibleTask$`, bloating the resume payload and task
  manifest so resume takes measurably longer.

## Expected

`vnode_locate` resolves cleanly for any element Qwik itself emitted into
the document. One of:

- Include framework-emitted task-registration scripts in the vnode-children
  chain of their DOM parent.
- Consult `q:p` to navigate to the virtual parent when present, instead of
  walking only the DOM `parentElement` chain.
- Place the script as a DOM child of its virtual-vnode parent's nearest
  intrinsic element.

## Actual

The script floats at `<body>` level with `q:p="<virtual-id>"`. Body's
vnode-children chain doesn't contain it. `vnode_getVNodeForChildNode`
exhausts siblings and throws.

## Where to look in source

- `src/root.tsx` — the failing pattern + detailed analysis in the file's
  top comment.
- `src/routes/index.tsx` — a tiny page with a button so a manual click
  surfaces the crash if `qinit`-at-load isn't enough.

## Notes from the original investigation

This was discovered in a large production Qwik app (an Nx monorepo). In that
app the crash manifests on a specific heavy page with many `useVisibleTask$`
consumers under it; lighter pages in the same app did not crash. So the
minimal structural pattern in this repro may or may not be sufficient on its
own — if it doesn't crash for you with just this code, add content/components
under `src/routes/index.tsx` until it does, then prune.

Reproduces in `pnpm dev`, `pnpm preview` (production build), and the
deployed Cloudflare Pages preview build — i.e., **not** a dev-only
artifact.

### Things that do NOT fix it

- Wrapping the two `useVisibleTask$` calls in a separate child
  `component$` with an intrinsic `<span>` root, then mounting that span
  inside `<body>`. Qwik still emits the consolidated `q-d:qinit` script
  at body level (this was tried in the original investigation).
- Adding `display: contents` wrappers around other elementless modal-host
  components in the tree.
- Removing the user-side `key={item.href}` pattern (a separate Qwik
  beta.35 bug — query-string chars in `key` corrupt `q:vnode`
  serialization).

### Existing qwik#8310 guard does not catch this class

The original app installs a `Node.prototype.insertBefore` guard to
neutralize the residual flush-phase race from qwik#8310. That guard
only patches `insertBefore`. This crash is at event-dispatch time —
`vnode_locate` → `vnode_getVNodeForChildNode` — no `insertBefore` is ever
called. The guard correctly stays silent; it's not the same bug.
