import { component$, useVisibleTask$ } from '@qwik.dev/core';
import { QwikRouterProvider, RouterOutlet } from '@qwik.dev/router';

/**
 * THE REPRO:
 *
 * This `component$` is "elementless" — its returned root JSX is another
 * `component$` (`QwikRouterProvider`), so it has no intrinsic DOM element
 * of its own. The two `useVisibleTask$` calls below have `strategy:
 * 'document-ready'` and `'document-idle'`.
 *
 * On Qwik 2.0.0-beta.35 AND 2.0.0-beta.36, this combination causes Qwik to
 * emit a CONSOLIDATED task-registration script element at <body> level,
 * looking like:
 *
 *   <script
 *     q-d:qinit="/@qwik-handlers#_run#2004"
 *     q-d:qrouterpopstate="/@qwik-handlers#_run#2005"
 *     q:p="2006"
 *     q-d:qcinit="/@qwik-handlers#_run#2007"
 *   ></script>
 *
 * The `q:p="2006"` is a VIRTUAL vnode reference. The script is logically a
 * child of that virtual vnode, but DOM-wise its parent is <body>.
 *
 * `vnode_locate` walks the DOM `parentElement` chain (it does NOT consult
 * `q:p`). When any qwik-handlers event fires on this script (qinit / qcinit
 * / qrouterpopstate at load time, or any subsequent event delegation that
 * targets it), `vnode_locate` reaches `<body>`, calls
 * `vnode_getVNodeForChildNode(bodyVNode, script)`, and walks body's
 * user-level vnode children. The script is NOT among them — it lives in a
 * sibling virtual subtree. The walker exhausts all siblings and asserts:
 *
 *   Internal assert, this is likely caused by a bug in Qwik: Missing child.
 *     at vnode_getVNodeForChildNode (core.mjs)
 *     at vnode_locate (core.mjs)
 *     at newInvokeContextFromDOM (core.mjs)
 *     at _run (core.mjs)
 *
 * The crash floods the console (every subsequent event re-fires it).
 *
 * ## Reproduction
 *
 * 1. `pnpm i`
 * 2. `pnpm dev`
 * 3. Open http://localhost:5173/
 * 4. Click the button on the page (or just wait — qinit fires on load).
 * 5. Observe the "Missing child" error in the DevTools console.
 *
 * ## Expected
 *
 * Qwik should either:
 *   (a) include framework-emitted task-registration scripts in the
 *       vnode children of their DOM parent so vnode_locate succeeds, or
 *   (b) use `q:p` to navigate to the virtual parent when present, or
 *   (c) place the script as a DOM child of its virtual vnode parent.
 *
 * ## Actual
 *
 * The script floats at <body> level with `q:p` pointing to a virtual
 * vnode that is not body's vnode-children chain → vnode_locate exhausts
 * siblings → throws.
 *
 * ## Why the existing JAQ-2237 insertBeforeGuard does not help
 *
 * That guard patches `Node.prototype.insertBefore` (the render-flush race
 * from qwik#8310). This crash is at event-dispatch time, not render-flush
 * — no `insertBefore` is ever called, so the guard never sees it. Confirmed
 * by patching `vnode_getVNodeForChildNode` with diagnostic logging: the
 * `targetChildDOM` is the bootstrap script described above, the
 * `parentLiveChildren` of `<body>` does not contain the script's vnode.
 */
export default component$(() => {
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    () => {
      // Any sync work — the body of this task is irrelevant to the crash.
      // The crash is caused purely by Qwik EMITTING the registration script
      // because of the strategy: 'document-ready' option, regardless of body.
      // eslint-disable-next-line no-console
      console.log('[repro] document-ready task ran');
    },
    { strategy: 'document-ready' },
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    () => {
      // eslint-disable-next-line no-console
      console.log('[repro] document-idle task ran');
    },
    { strategy: 'document-idle' },
  );

  return (
    <QwikRouterProvider>
      <head>
        <meta charset="utf-8" />
        <title>Qwik vnode_locate Missing-child repro</title>
      </head>
      <body>
        <RouterOutlet />
      </body>
    </QwikRouterProvider>
  );
});
