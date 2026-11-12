import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

export function useWorkbenchFileNavigation(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly threadId?: ThreadId;
}) {
  const navigation = useNavigation();
  return useCallback(
    (path: string) => {
      if (!input.cwd) return;
      const params = {
        environmentId: String(input.environmentId),
        cwd: input.cwd,
        path: path.split("/"),
      };
      if (input.threadId)
        navigation.navigate("ThreadFile", { ...params, threadId: String(input.threadId) });
      else navigation.navigate("NewTaskFile", params);
    },
    [input.cwd, input.environmentId, input.threadId, navigation],
  );
}
