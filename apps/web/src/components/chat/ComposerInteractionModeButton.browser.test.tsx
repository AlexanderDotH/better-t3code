import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { ComposerInteractionModeButton } from "./ComposerInteractionModeButton";

it("selects DeepPlan directly without cycling through other modes", async () => {
  const onModeChange = vi.fn();
  const onCycle = vi.fn();
  await using screen = await render(
    <ComposerInteractionModeButton mode="default" onCycle={onCycle} onModeChange={onModeChange} />,
  );
  await screen.getByRole("button").click();
  await page.getByRole("menuitemradio", { name: "Deep Plan", exact: true }).click();
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith("deep-plan");
  expect(onCycle).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("menuitemradio", { name: "Deep Plan", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(onCycle).toHaveBeenCalledOnce();
});

it("explains unavailable planning modes while keeping Build and Chat selectable", async () => {
  const onModeChange = vi.fn();
  const onCycle = vi.fn();
  await using screen = await render(
    <ComposerInteractionModeButton
      mode="default"
      planningEnabled={false}
      planningDisabledReason="Enable Plan mode in Settings."
      onCycle={onCycle}
      onModeChange={onModeChange}
    />,
  );
  await screen.getByRole("button").click();
  await expect
    .element(page.getByRole("menuitemradio", { name: "Plan", exact: true }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Deep Plan", exact: true }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Chat", exact: true }))
    .not.toHaveAttribute("aria-disabled", "true");
  expect(page.getByRole("menu").element().textContent).toContain("Enable Plan mode in Settings.");

  await screen.rerender(
    <ComposerInteractionModeButton
      mode="default"
      planningEnabled
      disabledReason="This provider does not support DeepPlan."
      onCycle={onCycle}
      onModeChange={onModeChange}
    />,
  );
  await expect
    .element(page.getByRole("menuitemradio", { name: "Plan", exact: true }))
    .not.toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Deep Plan", exact: true }))
    .toHaveAttribute("aria-disabled", "true");
  expect(page.getByRole("menu").element().textContent).toContain(
    "This provider does not support DeepPlan.",
  );
  await page.getByRole("menuitemradio", { name: "Chat", exact: true }).click();
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith("chat");
});
