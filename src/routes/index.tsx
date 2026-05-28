import { $, component$, useSignal, useVisibleTask$ } from '@qwik.dev/core';
import { routeLoader$ } from '@qwik.dev/router';

/**
 * Artificial latency in SSR. The crash only surfaces when a user click
 * lands BEFORE the client has fully resumed (specifically before Qwik's
 * dispatcher has processed `qinit` against the body-level bootstrap script).
 * On a near-instant page, qinit fires before the user can interact and
 * everything settles. The sleep below mimics a real app's slow SSR
 * (database round-trips, CMS fetches, GraphQL) so a manual click is easy
 * to land inside the crash window.
 *
 * Tweak `SSR_LATENCY_MS` if your machine is fast/slow.
 */
const SSR_LATENCY_MS = 1500;

export const useSlowSsrLoader = routeLoader$(async () => {
  await new Promise((resolve) => setTimeout(resolve, SSR_LATENCY_MS));
  return { ready: true, latencyMs: SSR_LATENCY_MS };
});

/**
 * A throwaway leaf component with its own `useVisibleTask$`. Replicating
 * many of these is the cheapest way to bloat the resume payload and the
 * task-registration manifest — in the real app the lobby has dozens of
 * components running visible tasks (analytics, intersection observers,
 * WS subscriptions). Increase `LEAVES` if you can't land a click inside
 * the crash window.
 *
 * **Strategy MUST be `document-ready`** to reproduce the real-app crash.
 * The default strategy (`intersection-observer`) attaches `q-e:qvisible`
 * to each leaf's own `<li>` element — vnode_locate walks the `<li>`'s real
 * DOM ancestry and never visits the body-level consolidated script.
 *
 * `document-ready` (and `document-idle`) tasks instead get registered on
 * the body-level consolidated `<script q-d:qinit q-d:qcinit ...>` element
 * that has `q:p` pointing at a virtual vnode missing from body's
 * vnode-children chain. Every entry on that script is a separate handler
 * that `vnode_locate` is asked to resolve at qinit / event-delegation
 * time — N leaves with `document-ready` = N entries on the body script =
 * N event-dispatch chances per dispatch to hit the desync.
 *
 * In a real app, a shared CMS-rendering component uses exactly this strategy
 * and runs for every tracked element on a heavy page — that's how the body
 * script collects dozens of `q-d:*` entries in production.
 */
const LEAVES = 1850;

const Leaf = component$<{ idx: number }>(({ idx }) => {
  const visible = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    () => {
      visible.value = true;
    },
    { strategy: 'document-ready' },
  );

  return (
    <li style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: 12 }}>
      leaf #{idx} — {visible.value ? 'visible-task ran' : 'not yet'}
    </li>
  );
});

export default component$(() => {
  const data = useSlowSsrLoader();
  const count = useSignal(0);

  return (
    <main
      style={{
        fontFamily: 'system-ui',
        padding: '2rem',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1>Qwik vnode_locate "Missing child" repro</h1>

      <p>
        SSR was held for {data.value.latencyMs} ms. Open the DevTools
        Console <strong>before</strong> the page finishes painting, then
        click the button below as soon as it appears. Within a tick you
        should see a "QWIK ERROR Internal assert ... Missing child" flood
        from <code>vnode_getVNodeForChildNode</code> via{' '}
        <code>newInvokeContextFromDOM</code>.
      </p>

      <p>
        If you can't land the click inside the crash window, bump{' '}
        <code>SSR_LATENCY_MS</code> at the top of{' '}
        <code>src/routes/index.tsx</code>, or increase <code>LEAVES</code>{' '}
        to bloat the resume payload further.
      </p>

      <button
        type="button"
        onClick$={$(() => {
          count.value += 1;
        })}
        style={{
          padding: '0.5rem 1rem',
          fontSize: 16,
          borderRadius: 4,
          border: '1px solid #888',
          cursor: 'pointer',
          background: '#f4f4f4',
        }}
      >
        Click me (clicks: {count.value})
      </button>

      <h2 style={{ marginTop: '2rem' }}>Resume payload bloat</h2>
      <p>
        {LEAVES} leaf components below — each carries its own
        <code> useVisibleTask$</code> to grow the task-registration
        manifest and the q:vnode payload. The crash is not <em>about</em>{' '}
        these — they exist only to make the resume window wide enough that
        a human can click during it.
      </p>
      <ul style={{ marginTop: '0.5rem' }}>
        {Array.from({ length: LEAVES }, (_, i) => (
          <Leaf key={i} idx={i} />
        ))}
      </ul>

      <p style={{ marginTop: '2rem', fontSize: 12, color: '#666' }}>
        See <code>src/root.tsx</code> for the failing pattern and detailed
        analysis of why <code>vnode_locate</code> fails.
      </p>
    </main>
  );
});
