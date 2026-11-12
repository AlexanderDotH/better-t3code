import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";

export const timelineControlAtom = Atom.family((_threadKey: string) =>
  Atom.make<{ readonly action: "find" | "jump-list"; readonly request: object } | null>(null).pipe(
    Atom.keepAlive,
  ),
);

export function requestTimelineControl(threadKey: string, action: "find" | "jump-list") {
  appAtomRegistry.set(timelineControlAtom(threadKey), { action, request: {} });
}
