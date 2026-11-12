import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../../connection/runtime";

export const threadPanelShell = {
  openInEditor: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:thread-panel:open-editor",
    tag: WS_METHODS.shellOpenInEditor,
  }),
};
