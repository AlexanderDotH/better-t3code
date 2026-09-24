import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProjectIndexModelSelection,
  type ProjectIndexStatusV1,
  type ProjectIndexStreamEvent,
  type ServerProvider,
} from "@t3tools/contracts";
import { act, StrictMode, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => ({ ...translator, message: (key: string) => key }) };
});
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => DEFAULT_UNIFIED_SETTINGS,
  usePrimarySettingsAvailable: () => true,
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "Unavailable",
}));
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled: boolean;
    "aria-label": string;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled: boolean;
    "aria-label": string;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../ui/alert-dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogClose: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogPopup: Container,
    AlertDialogTitle: Container,
  };
});
vi.mock("./ProjectIndexEntityBrowser", () => ({ ProjectIndexEntityBrowser: () => null }));
vi.mock("./ProjectIndexModelPicker", () => ({
  ProjectIndexModelPicker: ({
    providers,
    disabled,
    onChange,
  }: {
    providers: ReadonlyArray<ServerProvider>;
    disabled: boolean;
    onChange: (model: ProjectIndexModelSelection) => void;
  }) => (
    <div>
      {providers.flatMap((provider) =>
        provider.models.map((model) => (
          <button
            key={`${provider.instanceId}:${model.slug}`}
            disabled={disabled}
            onClick={() => onChange({ instanceId: provider.instanceId, model: model.slug })}
          >
            {`${provider.displayName} · ${model.name}`}
          </button>
        )),
      )}
    </div>
  ),
}));

import { ProjectIndexingSettingsController } from "./ProjectIndexingSettingsController";

const environmentId = EnvironmentId.make("remote-environment");
const projectId = ProjectId.make("project-a");
const instanceId = ProviderInstanceId.make("custom-analysis-provider");
const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId,
    driver: ProviderDriverKind.make("openaiCompatible"),
    displayName: "Analysis service",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-20T12:00:00.000Z",
    models: [{ slug: "precise-model", name: "Precise model", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
];

function initialStatus(): ProjectIndexStatusV1 {
  return {
    version: 1,
    scope: { projectId, scopeId: "scope-a", workspaceFingerprint: "workspace-a" },
    revision: 0,
    state: "disabled",
    settings: DEFAULT_PROJECT_INDEX_SETTINGS,
    job: null,
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    gaps: [],
    updatedAt: "2026-09-20T12:00:00.000Z",
  };
}

function fixture() {
  let status = initialStatus();
  const listeners = new Set<(event: ProjectIndexStreamEvent) => void>();
  const api: ProjectIndexClientApi = {
    getSettings: vi.fn(async () => status.settings),
    getStatus: vi.fn(async () => status),
    updateSettings: vi.fn(async ({ patch }) => {
      status = { ...status, settings: { ...status.settings, ...patch } };
      status = { ...status, state: status.settings.enabled ? "idle" : "disabled" };
      return status;
    }),
    start: vi.fn(async () => {
      status = { ...status, state: "queued", revision: status.revision + 1 };
      return status;
    }),
    control: vi.fn(async ({ action }) => {
      status = {
        ...status,
        state:
          action === "pause"
            ? "paused"
            : action === "resume"
              ? "queued"
              : action === "cancel"
                ? "cancelled"
                : "idle",
      };
      return status;
    }),
    query: vi.fn<ProjectIndexClientApi["query"]>(),
    checkModel: vi.fn(async () => ({ supported: true })),
    subscribe: vi.fn((_scope, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  return { api, getStatus: () => status, listeners };
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function mount(
  api: ProjectIndexClientApi,
  version: number | undefined = 3,
  canOperate = true,
) {
  await act(() => {
    renderer = create(
      <StrictMode>
        <ProjectIndexingSettingsController
          api={api}
          environmentId={environmentId}
          projectId={projectId}
          {...(version === undefined ? {} : { projectIndexingVersion: version })}
          projectLabel="Remote project"
          environmentLabel="Remote host"
          providers={providers}
          canOperate={canOperate}
          onOpenSource={() => undefined}
        />
      </StrictMode>,
    );
  });
}

function button(label: string) {
  return renderer!.root
    .findAllByType("button")
    .find((candidate) => candidate.children.includes(label))!;
}

async function setPreference(label: string, checked: boolean) {
  const input = renderer!.root
    .findAllByType("input")
    .find((candidate) => candidate.props["aria-label"] === label)!;
  await act(() => input.props.onChange({ currentTarget: { checked } }));
}

describe("ProjectIndexingSettingsController", () => {
  it("indexes without a model and checks a model only for the optional review", async () => {
    const { api, getStatus, listeners } = fixture();
    await mount(api);
    expect(listeners.size).toBe(1);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.checkModel).not.toHaveBeenCalled();
    expect(getStatus().settings.modelSelection).toBeNull();

    await setPreference("projectIndexing.enabled", true);
    expect(api.start).not.toHaveBeenCalled();
    expect(button("projectIndexing.analyze").props.disabled).toBe(false);
    expect(
      renderer!.root.findAllByProps({ "aria-label": "projectIndexing.automaticAiUpdate" }),
    ).toHaveLength(0);
    await act(() => button("projectIndexing.analyze").props.onClick());
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.checkModel).not.toHaveBeenCalled();

    await setPreference("projectIndexing.reviewEnabled", true);
    await act(() => button("Analysis service · Precise model").props.onClick());
    expect(api.checkModel).toHaveBeenCalledWith({
      projectId,
      modelSelection: { instanceId, model: "precise-model" },
    });
    await act(() => renderer!.unmount());
    expect(listeners.size).toBe(0);
    renderer = undefined;
  });

  it("does not contact an older environment when opening the unavailable settings section", async () => {
    const { api } = fixture();
    await mount(api, 2);
    expect(api.getStatus).not.toHaveBeenCalled();
    expect(api.subscribe).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("keeps status readable while blocking every mutation from a read-only connection", async () => {
    const { api } = fixture();
    await mount(api, 3, false);
    expect(api.getStatus).toHaveBeenCalled();
    const enabled = renderer!.root
      .findAllByType("input")
      .find((input) => input.props["aria-label"] === "projectIndexing.enabled")!;
    expect(enabled.props.disabled).toBe(true);
    await setPreference("projectIndexing.enabled", true);
    await act(() => button("projectIndexing.analyze").props.onClick());
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("clears only after confirmation and can pause, resume, and cancel the active job", async () => {
    const { api, getStatus } = fixture();
    await mount(api);
    await setPreference("projectIndexing.enabled", true);
    await act(() => button("projectIndexing.analyze").props.onClick());
    await act(() => button("projectIndexing.pause").props.onClick());
    expect(getStatus().state).toBe("paused");
    await act(() => button("projectIndexing.resumeIndexing").props.onClick());
    expect(getStatus().state).toBe("queued");
    await act(() => button("projectIndexing.cancel").props.onClick());
    expect(getStatus().state).toBe("cancelled");
    await act(() => button("projectIndexing.clear").props.onClick());
    expect(vi.mocked(api.control).mock.calls.map(([input]) => input.action)).toEqual([
      "pause",
      "resume",
      "cancel",
    ]);
    const dialog = renderer!.root.findByProps({ role: "alertdialog" });
    const confirm = dialog
      .findAllByType("button")
      .find((candidate) => candidate.children.includes("projectIndexing.clear"))!;
    await act(() => confirm.props.onClick());
    expect(api.control).toHaveBeenLastCalledWith({ projectId, action: "clear" });
  });
});
