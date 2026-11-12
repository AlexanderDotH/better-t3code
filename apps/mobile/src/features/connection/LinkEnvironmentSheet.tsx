import { useAtomValue } from "@effect/atom-react";
import { type LinkableMachine } from "@t3tools/client-runtime/link-request";
import {
  AuthAccessWriteScope,
  type AuthMcpClientAccess,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { useRef, useState } from "react";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mintPairingCodeOn } from "../../state/peerPairingCode";
import { peerLinkEnvironment, useLinkableMachines } from "../../state/peerLinks";
import { useEnvironmentScope, usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";
import { AccessSheet } from "./AccessSheet";
import { ConnectionFormField } from "./ConnectionFormField";

const MANUAL_ADDRESS = "manual-address";

export function LinkEnvironmentSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly initialTarget?: Pick<LinkableMachine, "environmentId" | "label" | "urls"> & {
    readonly access: AuthMcpClientAccess;
  };
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const machines = useLinkableMachines(props.environmentId, true);
  const [choice, setChoice] = useState<string>(
    props.initialTarget?.environmentId ?? MANUAL_ADDRESS,
  );
  const selected =
    machines.find((machine) => machine.environmentId === choice) ??
    (props.initialTarget?.environmentId === choice ? props.initialTarget : null);
  const targetId = selected?.environmentId ?? null;
  const prepared = usePreparedConnection(targetId);
  const mayMint = useEnvironmentScope(targetId, AuthAccessWriteScope);
  const [mintFailed, setMintFailed] = useState(false);
  const canMint = targetId !== null && Option.isSome(prepared) && mayMint && !mintFailed;
  const [address, setAddress] = useState(props.initialTarget?.urls[0] ?? "");
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>(
    props.initialTarget?.access ?? "approval-required",
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const link = useAtomCommand(peerLinkEnvironment.link, {
    reportFailure: false,
    reportDefect: false,
  });
  const permitted = useAtomValue(peerLinkEnvironment.link.permissionAtom(props.environmentId));
  const needsAddress = selected === null || selected.urls.length === 0;
  const urls = needsAddress ? [address.trim()] : selected.urls;
  const ready = (urls[0]?.length ?? 0) > 0 && (canMint || code.trim().length > 0);

  async function submit() {
    if (inFlight.current || !ready || !permitted || !urls[0]) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    let pairingCode = code.trim();
    if (canMint && targetId !== null) {
      const minted = await mintPairingCodeOn(targetId, access);
      if (Result.isFailure(minted)) {
        setMintFailed(true);
        setError(true);
        inFlight.current = false;
        setBusy(false);
        return;
      }
      pairingCode = minted.success;
    }
    const result = await link({
      environmentId: props.environmentId,
      input: {
        url: urls[0],
        ...(urls.length > 1 ? { alternateUrls: urls.slice(1) } : {}),
        ...(selected
          ? { expectedEnvironmentId: selected.environmentId, expectedLabel: selected.label }
          : {}),
        pairingCode,
        access,
      },
    });
    inFlight.current = false;
    setBusy(false);
    if (result._tag === "Success") {
      setCode("");
      props.onClose();
    } else setError(true);
  }

  return (
    <AccessSheet
      title={translator.message("mobile.access.linkEnvironment")}
      busy={busy}
      onClose={props.onClose}
    >
      <AppText className="text-foreground-muted">
        {translator.message("mobile.access.linkHint")}
      </AppText>
      <SettingsSection title={translator.message("mobile.ui.machine")}>
        {machines.map((machine) => (
          <ListChoiceRow
            key={machine.environmentId}
            label={machine.label}
            description={machine.urls.join(", ")}
            selected={choice === machine.environmentId}
            disabled={busy}
            onPress={() => {
              setChoice(machine.environmentId);
              setMintFailed(false);
              setCode("");
            }}
          />
        ))}
        <ListChoiceRow
          label={translator.message("mobile.access.anotherAddress")}
          selected={choice === MANUAL_ADDRESS}
          disabled={busy}
          onPress={() => {
            setChoice(MANUAL_ADDRESS);
            setMintFailed(false);
            setCode("");
          }}
        />
      </SettingsSection>
      {needsAddress ? (
        <ConnectionFormField
          label={translator.message("mobile.ui.address")}
          value={address}
          onChangeText={setAddress}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
      ) : null}
      {!canMint ? (
        <ConnectionFormField
          label={translator.message("mobile.connection.pairingCode")}
          value={code}
          onChangeText={setCode}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
      ) : null}
      <SettingsSection
        title={translator.message("mobile.ui.whatAgentsHereMayDoThere")}
        footer={translator.message("mobile.ui.anAgentHereNeverGetsMoreThere")}
      >
        <ListChoiceRow
          label={translator.message("settings.connections.readOnly")}
          description={translator.message("mobile.ui.readProjectsAndThreadsCannotStartMessage")}
          selected={access === "read-only"}
          onPress={() => setAccess("read-only")}
          disabled={busy}
        />
        {RUNTIME_MODE_CHOICES.map((mode) => (
          <ListChoiceRow
            key={mode.mode}
            label={mode.label}
            description={mode.description}
            selected={access === mode.mode}
            disabled={busy}
            onPress={() => setAccess(mode.mode)}
          />
        ))}
      </SettingsSection>
      {error ? (
        <AppText accessibilityRole="alert" className="text-danger-foreground">
          {translator.message(
            mintFailed ? "mobile.access.pasteCodeFallback" : "mobile.access.mutationFailed",
          )}
        </AppText>
      ) : null}
      <Button
        label={translator.message("mobile.access.link")}
        tone="primary"
        loading={busy}
        disabled={!ready || !permitted}
        onPress={() => void submit()}
      />
    </AccessSheet>
  );
}
