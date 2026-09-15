import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
import { InlineMessageEditor } from "./InlineMessageEditor";

it("keeps the edited draft after a failed save and allows retry", async () => {
  const onClose = vi.fn();
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error("Reconnect first"))
    .mockResolvedValueOnce(undefined);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <InlineMessageEditor
        draftRef={{ current: "Original" }}
        available
        onSave={onSave}
        onClose={onClose}
      />,
    );
  });
  const textarea = () => renderer.root.findByType("textarea");
  const submit = () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  await act(async () => {
    textarea().props.onChange({ target: { value: "Corrected text" } });
  });
  await act(async () => {
    submit();
  });
  expect(onSave).toHaveBeenLastCalledWith("Corrected text");
  expect(onClose).not.toHaveBeenCalled();
  expect(textarea().props.value).toBe("Corrected text");
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual(["Reconnect first"]);
  await act(async () => {
    submit();
  });
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => renderer.unmount());
});

it("blocks empty and disconnected edits while allowing cancellation", async () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <InlineMessageEditor
        draftRef={{ current: "Original" }}
        available={false}
        onSave={onSave}
        onClose={onClose}
      />,
    );
  });
  const buttons = () => renderer.root.findAllByType("button");
  expect(
    buttons()
      .slice(1)
      .every((button) => button.props.disabled),
  ).toBe(true);
  await act(async () => {
    renderer.update(
      <InlineMessageEditor
        draftRef={{ current: "Original" }}
        available
        onSave={onSave}
        onClose={onClose}
      />,
    );
  });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "  " } });
  });
  expect(
    buttons()
      .slice(1)
      .every((button) => button.props.disabled),
  ).toBe(true);
  await act(async () => buttons()[0]!.props.onClick());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

it("preserves the draft when a virtualized row remounts, supports keyboard save and cancellation", async () => {
  const draftRef = { current: "Original" };
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const element = (
    <InlineMessageEditor draftRef={draftRef} available onSave={onSave} onClose={onClose} />
  );
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "Kept draft" } });
  });
  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = create(element);
  });
  expect(renderer.root.findByType("textarea").props.value).toBe("Kept draft");
  const key = (key: string, isComposing = false) => ({
    key,
    ctrlKey: true,
    nativeEvent: { isComposing },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
  await act(async () => renderer.root.findByType("form").props.onKeyDown(key("Enter", true)));
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType("form").props.onKeyDown(key("Enter")));
  expect(onSave).toHaveBeenCalledWith("Kept draft");
  await act(async () => renderer.root.findByType("form").props.onKeyDown(key("Escape")));
  expect(onClose).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});
