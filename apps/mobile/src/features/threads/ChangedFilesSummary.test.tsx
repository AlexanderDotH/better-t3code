// @vitest-environment jsdom

import {
  CheckpointRef,
  MessageId,
  TurnId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  View: (props: { children?: ReactNode }) => createElement("div", {}, props.children),
  Pressable: (props: { children?: ReactNode; onPress?: () => void; accessibilityLabel?: string }) =>
    createElement(
      "button",
      { onClick: props.onPress, "aria-label": props.accessibilityLabel },
      props.children,
    ),
}));
vi.mock("../../components/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => createElement("span", {}, props.children),
}));
vi.mock("../../components/PierreEntryIcon", () => ({ PierreEntryIcon: () => null }));
vi.mock("./ChatPresentationMotion", () => ({
  ChatPresentationMotion: (props: { children?: ReactNode }) => props.children,
}));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

import { ChangedFilesSummary } from "./ChangedFilesSummary";

it("shows three real files, expands in source order, and collapses without losing the review action", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const checkpoint: OrchestrationCheckpointSummary = {
    turnId: TurnId.make("turn"),
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.make("checkpoint"),
    status: "ready",
    assistantMessageId: MessageId.make("answer"),
    completedAt: "2026-10-26T12:00:00Z",
    files: Array.from({ length: 5 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      kind: "modified",
      additions: index,
      deletions: 1,
    })),
  };
  const openReview = vi.fn();
  function Summary() {
    const [expanded, setExpanded] = useState(false);
    return (
      <ChangedFilesSummary
        checkpoint={checkpoint}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        onOpenReview={openReview}
      />
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<Summary />));
    const fileNames = () =>
      [...host.querySelectorAll("button[aria-label]")].map((button) =>
        button.getAttribute("aria-label"),
      );
    expect(fileNames()).toEqual(checkpoint.files.slice(0, 3).map((file) => file.path));
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Show all"))!
        .click(),
    );
    expect(fileNames()).toEqual(checkpoint.files.map((file) => file.path));
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Show fewer"))!
        .click(),
    );
    expect(fileNames()).toHaveLength(3);
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    expect(openReview).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
