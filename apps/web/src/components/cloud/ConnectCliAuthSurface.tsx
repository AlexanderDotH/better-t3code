import { useAuth, useClerk, useUser } from "@clerk/react";
import { encodeConnectAuthCode, readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliSignInRedirectUrl,
  readConnectCliAuthState,
  readConnectCliCallbackResult,
  rememberConnectCliAuthState,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
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
        <p className="text-[10px] font-semibold tracking-[0.18em] text-blue-600 uppercase dark:text-blue-400">
          {eyebrow}
        </p>
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
 * /connect: the URL the CLI prints for both flows. Waits for a Clerk session,
 * then forwards the CLI's PKCE request to Clerk's authorize endpoint — with a
 * loopback redirect URI when the request carries a port, so the code returns
 * straight to the waiting CLI, and the hosted callback page otherwise.
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
    // Clerk redirects to the authorize endpoint itself once sign-in completes,
    // so the callback's state check has to be armed before handing off.
    rememberConnectCliAuthState(request.state);
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
    rememberConnectCliAuthState(request.state);
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

/**
 * /connect/callback: Clerk's redirect target. Shows the one-time code the
 * user enters in the waiting terminal.
 */
export function ConnectCliCallbackSurface() {
  const translator = useInterfaceTranslator();
  const [result] = useState(readConnectCliCallbackResult);
  const [expectedState] = useState(readConnectCliAuthState);
  const { user } = useUser();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "authentication code" });

  if (!result) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage
          eyebrow={translator.message("connectCli.terminalStep")}
          title={translator.message("connectCli.callback.missingTitle")}
          description={translator.message("connectCli.callback.missingDescription")}
        />
      </AuthSurfaceShell>
    );
  }

  // Fail closed: the legitimate callback always lands in the same browser
  // that visited /connect (which recorded the state), so a missing or
  // mismatched state means this page was reached some other way — the CSRF
  // shape the state parameter exists to stop. Refuse to display a code.
  if (expectedState === null || expectedState !== result.state) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage
          eyebrow={translator.message("connectCli.terminalStep")}
          title={translator.message("connectCli.callback.mismatchTitle")}
          description={translator.message("connectCli.callback.mismatchDescription")}
        />
      </AuthSurfaceShell>
    );
  }

  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? null;
  const authCode = encodeConnectAuthCode(result);

  return (
    <AuthSurfaceShell>
      <ConnectCliAuthMessage
        eyebrow={translator.message("connectCli.terminalStep")}
        title={translator.message("connectCli.callback.title")}
        description={
          accountLabel
            ? translator.message("connectCli.callback.accountDescription", {
                account: accountLabel,
              })
            : translator.message("connectCli.callback.description")
        }
      />

      <div className="mt-6 overflow-hidden rounded-xl border border-border/80 bg-background/65">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
          <span className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {translator.message("connectCli.callback.codeLabel")}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {translator.message("connectCli.callback.expiresSoon")}
          </span>
        </div>
        <code
          className="block p-4 font-mono text-sm leading-relaxed break-all select-all"
          data-testid="connect-auth-code"
        >
          {authCode}
        </code>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={() => copyToClipboard(authCode)}>
          {translator.message(isCopied ? "connectCli.callback.copied" : "connectCli.callback.copy")}
        </Button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        {translator.message("connectCli.callback.securityNotice")}
      </p>
    </AuthSurfaceShell>
  );
}
