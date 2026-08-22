import { useClerk } from "@clerk/react";

import { isElectron } from "../../env";
import { resolveClerkSignInProps, type ClerkSignInProps } from "./authRedirect";

interface ClerkSignInController {
  readonly openSignIn: (props: ClerkSignInProps) => unknown;
}

export function openT3ConnectAuthPrompt(
  clerk: ClerkSignInController,
  href: string,
  electron: boolean,
): void {
  clerk.openSignIn(resolveClerkSignInProps(href, electron));
}

export function useT3ConnectAuthPrompt() {
  const clerk = useClerk();
  return () => openT3ConnectAuthPrompt(clerk, window.location.href, isElectron);
}
