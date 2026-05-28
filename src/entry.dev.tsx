/**
 * Development entry point.
 * Imported by Vite's dev server (qwikVite plugin handles the rest).
 */
import { render, type RenderOptions } from '@qwik.dev/core';
import Root from './root';

export default function (opts: RenderOptions) {
  return render(document, <Root />, opts);
}
