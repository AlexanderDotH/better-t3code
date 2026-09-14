import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../ui/dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
import { EditMessageDialog } from "./EditMessageDialog";

it.each(["continue", "restart"] as const)(
  "keeps the edited draft after a failed %s and allows retry",
  async (mode) => {
    const onClose = vi.fn();
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Reconnect first"))
      .mockResolvedValueOnce(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <EditMessageDialog
          text="Original"
          available
          canRestart
          onSave={onSave}
          onClose={onClose}
        />,
      );
    });
    const textarea = () => renderer.root.findByType("textarea");
    const submit = () =>
      renderer.root
        .findAllByType("button")
        .find((button) => button.props.children === `chat.edit.${mode}`)!;
    await act(async () => {
      textarea().props.onChange({ target: { value: "Corrected text" } });
    });
    await act(async () => {
      submit().props.onClick();
    });
    expect(onSave).toHaveBeenLastCalledWith("Corrected text", mode);
    expect(onClose).not.toHaveBeenCalled();
    expect(textarea().props.value).toBe("Corrected text");
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual(["Reconnect first"]);
    await act(async () => {
      submit().props.onClick();
    });
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer.unmount());
  },
);

it("blocks empty and disconnected edits while allowing cancellation", async () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <EditMessageDialog
        text="Original"
        available={false}
        canRestart
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
      <EditMessageDialog text="Original" available canRestart onSave={onSave} onClose={onClose} />,
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
