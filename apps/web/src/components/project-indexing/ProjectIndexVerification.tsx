import type { ProjectIndexQueryResultV1 } from "@t3tools/contracts";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export function ProjectIndexVerification({
  verification,
}: {
  readonly verification: ProjectIndexQueryResultV1["verification"];
}) {
  const { message, number } = useInterfaceTranslator();
  return (
    <section
      className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
      aria-label={message("projectIndexing.verification.title")}
    >
      <h4 className="text-xs font-medium">{message("projectIndexing.verification.title")}</h4>
      {verification ? (
        <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <li>{message("projectIndexing.verification.contextProvided")}</li>
          <li>
            <p>
              {message(
                `projectIndexing.verification.sourceState.${verification.sourceHashes.state}`,
              )}
            </p>
            <p>
              {message("projectIndexing.verification.sourceHashes", {
                matched: number(verification.sourceHashes.matchedFiles),
                changed: number(verification.sourceHashes.changedFiles),
                missing: number(verification.sourceHashes.missingFiles),
                unverified: number(verification.sourceHashes.unverifiedFiles),
              })}
            </p>
          </li>
          <li>{message("projectIndexing.verification.checksNotRun")}</li>
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {message("projectIndexing.verification.unavailable")}
        </p>
      )}
    </section>
  );
}
