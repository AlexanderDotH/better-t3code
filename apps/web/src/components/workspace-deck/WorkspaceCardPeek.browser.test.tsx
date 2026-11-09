import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { WorkspaceCardPeek } from "./WorkspaceCardPeek";

it("opens Git through its visible strip while preserving the branch control", async () => {
  const onActivate = vi.fn();
  const onBranch = vi.fn();
  const container = document.createElement("div");
  container.style.cssText = "position:relative;width:500px;height:100px;margin:50px";
  await using screen = await render(
    <WorkspaceCardPeek
      cardId="git"
      label="Git workspace"
      position="next"
      blocked={false}
      onActivate={onActivate}
    >
      <div className="pointer-events-auto w-full min-w-0" data-workspace-card-peek-id="git">
        <span className="flex-1">3 changes</span>
        <button type="button" data-composer-context-control onClick={onBranch}>
          Choose branch
        </button>
      </div>
    </WorkspaceCardPeek>,
    { container },
  );
  const trigger = screen.getByRole("button", { name: "Open Git workspace" });
  await expect.element(trigger).toBeVisible();
  const bounds = trigger.element().getBoundingClientRect();
  expect(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).toBe(
    trigger.element(),
  );
  await trigger.click();
  expect(onActivate).toHaveBeenCalledOnce();
  await screen.getByRole("button", { name: "Choose branch" }).click();
  expect(onBranch).toHaveBeenCalledOnce();
  expect(onActivate).toHaveBeenCalledOnce();
});
