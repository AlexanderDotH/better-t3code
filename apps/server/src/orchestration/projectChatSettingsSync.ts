import type { OrchestrationCommand } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";

import type { ServerSettingsService } from "../serverSettings.ts";

export const syncProjectChatSettingsForCommand = Effect.fn("syncProjectChatSettingsForCommand")(
  function* (
    settingsService: Pick<ServerSettingsService["Service"], "modifySettings">,
    command: OrchestrationCommand,
  ) {
    if (command.type === "project.delete") {
      yield* settingsService.modifySettings((current) =>
        Effect.succeed(
          current.projectChatSettings[command.projectId] === undefined
            ? current
            : applyServerSettingsPatch(current, {
                projectChatSettings: { [command.projectId]: null },
              }),
        ),
      );
      return;
    }
    if (command.type !== "project.meta.update" || command.defaultModelSelection === undefined) {
      return;
    }
    const selection = command.defaultModelSelection;
    yield* settingsService.modifySettings((current) => {
      const overrides = { ...current.projectSettingsOverrides[command.projectId] };
      if (selection === null) {
        delete overrides.defaultModelSelection;
      } else {
        overrides.defaultModelSelection = selection;
      }
      // Legacy clients still change the project aggregate. Mirror their
      // explicit default into the canonical settings so remembered choices reset.
      return Effect.succeed(
        applyServerSettingsPatch(current, {
          projectSettingsOverrides: { [command.projectId]: overrides },
        }),
      );
    });
  },
);
