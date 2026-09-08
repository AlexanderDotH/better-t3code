import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AssetUrlState } from "../../assets/assetUrls";
import { isAudioAttachment, type ChatAttachment, type ChatAudioAttachment } from "../../types";
import { MessageAudioAttachments } from "./MessageAudioAttachments";

const assets = vi.hoisted(() => ({
  state: { _tag: "Loading" } as AssetUrlState,
  resolve: vi.fn(),
  refresh: vi.fn<() => Promise<void>>(),
}));
vi.mock("../../assets/assetUrls", () => ({
  useAssetUrlState: (...args: unknown[]) => {
    assets.resolve(...args);
    return assets.state;
  },
  useAssetUrlRefresh: () => assets.refresh,
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

const environmentId = EnvironmentId.make("remote-environment");
const attachment: ChatAudioAttachment = {
  type: "audio",
  id: "audio-attachment",
  name: "response.wav",
  mimeType: "audio/wav",
  sizeBytes: 128,
};
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  assets.state = { _tag: "Loading" };
  assets.resolve.mockClear();
  assets.refresh.mockReset();
  assets.refresh.mockResolvedValue();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const renderAttachments = (attachments: ReadonlyArray<ChatAudioAttachment> = [attachment]) =>
  act(async () => {
    const element = (
      <MessageAudioAttachments environmentId={environmentId} attachments={attachments} />
    );
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });

describe("MessageAudioAttachments", () => {
  it("selects audio without claiming other known or future attachment types", () => {
    const attachments: ReadonlyArray<ChatAttachment> = [
      attachment,
      { ...attachment, type: "image", mimeType: "image/png" },
      { ...attachment, type: "file" },
      { ...attachment, type: "future-audio" },
    ];
    expect(attachments.filter(isAudioAttachment)).toEqual([attachment]);
  });

  it("loads signed audio in its environment and preserves playing audio when its URL refreshes", async () => {
    await renderAttachments();
    expect(renderer!.root.findByProps({ role: "status" }).children).toEqual(["common.loading"]);
    expect(assets.resolve).toHaveBeenCalledWith(environmentId, {
      _tag: "attachment",
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: attachment.mimeType,
    });

    assets.state = { _tag: "Success", url: "https://remote.test/audio?signature=first" };
    await renderAttachments();
    const player = renderer!.root.findByType("audio");
    await act(async () => player.props.onPlay());
    assets.state = { _tag: "Success", url: "https://remote.test/audio?signature=next" };
    await renderAttachments();
    expect(renderer!.root.findByType("audio").props.src).toContain("signature=first");

    await act(async () => renderer!.root.findByType("audio").props.onError());
    expect(renderer!.root.findByType("audio").props.src).toContain("signature=next");
  });

  it("recovers a playback error by requesting a new signed URL and keeps failures visible", async () => {
    assets.state = { _tag: "Success", url: "https://remote.test/audio?signature=expired" };
    await renderAttachments();
    await act(async () => renderer!.root.findByType("audio").props.onError());
    expect(renderer!.root.findAllByType("audio")).toHaveLength(0);
    expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
      "chat.timeline.audioUnavailable",
    );

    assets.refresh.mockRejectedValueOnce(new Error("Disconnected"));
    await act(async () => renderer!.root.findByType("button").props.onClick());
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);

    assets.refresh.mockImplementationOnce(async () => {
      assets.state = { _tag: "Success", url: "https://remote.test/audio?signature=fresh" };
    });
    await act(async () => renderer!.root.findByType("button").props.onClick());
    expect(assets.refresh).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType("audio").props.src).toContain("signature=fresh");
  });
});
