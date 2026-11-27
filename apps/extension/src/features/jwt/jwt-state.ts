// What the page and the tree's "Decode JWT" action share (TARGET.md 3.4: an
// item shares state through a module-local store in its own directory). It
// lives in memory only: a token is a credential, so it is never written to
// storage, recents or the address, and a reload forgets it.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type JwtState = {
  /** The text in the box, exactly as typed or pasted. */
  readonly token: string;
  /** Why the token the tree handed over could not be read; the next edit clears it. */
  readonly notice: string;
};

export const IDLE: JwtState = { token: "", notice: "" };

export const jwtState = createStore<JwtState>(() => IDLE);

export function useJwt<T>(select: (state: JwtState) => T): T {
  return useStore(jwtState, select);
}
