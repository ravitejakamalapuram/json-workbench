/**
 * Placeholder for an item that is not built yet. Every registry entry starts
 * as one, so the app boots and every entry mounts from the first commit; an
 * item replaces its stub's body and nothing outside it changes.
 */
export function Stub({ id }: { readonly id: string }) {
  return <p data-testid={`stub-${id}`}>{id} is not built yet.</p>;
}
