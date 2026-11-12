interface StackSnapshot {
  readonly index: number;
  readonly routes: ReadonlyArray<{ readonly key: string }>;
}

export function canRestoreForwardNavigation(current: StackSnapshot, destination: StackSnapshot) {
  return (
    current.index === destination.index - 1 &&
    current.routes.length === destination.routes.length - 1 &&
    current.routes.every((route, index) => route.key === destination.routes[index]?.key)
  );
}
