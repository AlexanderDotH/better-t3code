import { useAuth, useClerk } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliSignInRedirectUrl,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { AuthSurfaceShell } from "../auth/AuthSurfaceShell";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { Button } from "../ui/button";

function ConnectCliAuthMessage({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <>
      {eyebrow ? (
        <p className="text-3xs font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>
      ) : null}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}

const invalidLinkMessage = {
  eyebrow: "connectCli.authorizationRequest",
  title: "connectCli.incomplete.title",
  description: "connectCli.incomplete.description",
} as const;

/**
 * /connect: the URL the CLI prints for the loopback flow. Waits for a Clerk
 * session, then forwards the CLI's PKCE request to Clerk's authorize endpoint
 * with the loopback redirect URI so the code returns straight to the waiting
 * CLI. Headless hosts use Clerk's device authorization page instead.
 */
export function ConnectCliAuthorizeSurface() {
  const translator = useInterfaceTranslator();
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const signInOpened = useRef(false);
  const redirecting = useRef(false);

  const openSignIn = useCallback(() => {
    if (!request) {
      return;
    }
    clerk.openSignIn(
      resolveClerkSignInProps(
        connectCliSignInRedirectUrl(request, window.location.href),
        isElectron,
      ),
    );
  }, [clerk, request]);

  useEffect(() => {
    if (!request || !isLoaded || redirecting.current) {
      return;
    }
    if (!isSignedIn) {
      if (!signInOpened.current) {
        signInOpened.current = true;
        openSignIn();
      }
      return;
    }
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) {
      return;
    }
    redirecting.current = true;
    window.location.assign(authorizeUrl);
  }, [isLoaded, isSignedIn, openSignIn, request]);

  if (!request) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage
          eyebrow={translator.message(invalidLinkMessage.eyebrow)}
          title={translator.message(invalidLinkMessage.title)}
          description={translator.message(invalidLinkMessage.description)}
        />
      </AuthSurfaceShell>
    );
  }

  return (
    <AuthSurfaceShell>
      <ConnectCliAuthMessage
        eyebrow={
          request.loopbackPort === undefined
            ? translator.message("connectCli.browserStepNumbered")
            : translator.message("connectCli.browserStep")
        }
        title={translator.message("connectCli.connecting.title")}
        description={
          isSignedIn
            ? translator.message("connectCli.connecting.redirecting")
            : translator.message("connectCli.connecting.signIn")
        }
      />
      {isLoaded && !isSignedIn ? (
        <div className="mt-6">
          <Button type="button" onClick={openSignIn}>
            {translator.message("cloud.action.signIn")}
          </Button>
        </div>
      ) : null}
    </AuthSurfaceShell>
  );
}
