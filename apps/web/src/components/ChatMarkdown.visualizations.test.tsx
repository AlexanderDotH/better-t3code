import { EnvironmentId } from "@t3tools/contracts";
import { VISUALIZATION_CHANNEL } from "@t3tools/client-runtime/visualizations/model";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const feature = vi.hoisted(() => ({ enabled: false }));
vi.mock("../hooks/useVisualizationsEnabled", () => ({
  useVisualizationsEnabled: () => feature.enabled,
}));
vi.mock("../hooks/useBetterT3Feature", () => ({ useBetterT3DeviceFeature: () => false }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/interfaceLanguageSync", () => ({ useInterfaceLanguage: () => ({ language: "en" }) }));
vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("./ui/dialog", () => ({
  Dialog: () => null,
  DialogClose: () => null,
  DialogDescription: () => null,
  DialogPopup: () => null,
  DialogTitle: () => null,
}));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({ readThreadShell: () => null, useProjects: () => [] }));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown from "./ChatMarkdown";

it("stops the real preview bridge and releases its SVG when the feature switches off", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const messages = Object.assign(new EventTarget(), {
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
  });
  const emit = (source: unknown, data: unknown) => {
    messages.dispatchEvent(Object.assign(new Event("message"), { source, data }));
  };
  let resolveRequest!: (request: { requestId: string }) => void;
  const requested = {
    promise: new Promise<{ requestId: string }>((resolve) => {
      resolveRequest = resolve;
    }),
    resolve: (request: { requestId: string }) => resolveRequest(request),
  };
  const frame = {
    sandbox: { add: vi.fn() },
    setAttribute: vi.fn(),
    style: {},
    remove: vi.fn(),
    contentWindow: {
      postMessage: vi.fn((request: { requestId: string }) => requested.resolve(request)),
    },
    set srcdoc(_value: string) {
      queueMicrotask(() =>
        emit(frame.contentWindow, { channel: VISUALIZATION_CHANNEL, type: "ready" }),
      );
    },
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" });
  vi.stubGlobal("window", messages);
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      baseURI: "https://example.test/thread/a",
      body: { append: vi.fn() },
      createElement: () => frame,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:diagram-preview");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
  const source = "```mermaid\nflowchart LR\nAlpha --> Beta\n```";
  const markdown = (isStreaming: boolean) => (
    <ChatMarkdown
      text={source}
      cwd="/tmp/project"
      environmentId={EnvironmentId.make("diagram-test")}
      isStreaming={isStreaming}
    />
  );
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(markdown(false));
    });
    expect(fetch).not.toHaveBeenCalled();

    feature.enabled = true;
    await act(async () => {
      renderer!.update(markdown(true));
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const request = await requested.promise;
    await act(async () => {
      emit(frame.contentWindow, {
        channel: VISUALIZATION_CHANNEL,
        type: "result",
        requestId: request.requestId,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Alpha to Beta</text></svg>',
      });
    });
    expect(renderer!.root.findAllByProps({ src: "blob:diagram-preview" })).toHaveLength(1);
    expect(createUrl).toHaveBeenCalledOnce();

    feature.enabled = false;
    await act(async () => {
      renderer!.update(markdown(false));
    });
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith("blob:diagram-preview");
    expect(renderer!.root.findAllByProps({ src: "blob:diagram-preview" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "data-language": "mermaid" })).toHaveLength(1);
    await act(async () => {
      emit(frame.contentWindow, {
        channel: VISUALIZATION_CHANNEL,
        type: "result",
        requestId: request.requestId,
        svg: "<svg/>",
      });
    });
    expect(createUrl).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(frame.contentWindow.postMessage).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    feature.enabled = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
