import { StackActions, useNavigation } from "@react-navigation/native";
import { createContext, use } from "react";
import { Platform } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

export type ThreadInspectorTarget = {
  readonly type: "thread" | "device";
  readonly environmentId: string;
  readonly threadId: string;
  readonly deviceKey?: string;
};

export const ThreadInspectorNavigationContext = createContext<
  ((target: ThreadInspectorTarget) => void) | null
>(null);

export function useOpenThreadInspector() {
  const navigation = useNavigation();
  const { fileInspector } = useAdaptiveWorkspaceLayout();
  const openInInspector = use(ThreadInspectorNavigationContext);
  return (
    source: { readonly environmentId: string; readonly threadId: string },
    target: ThreadInspectorTarget,
  ) => {
    if (Platform.OS !== "ios" || !fileInspector.supported) return false;
    if (openInInspector) openInInspector(target);
    else {
      const state = navigation.getState();
      const parent = state?.routes.findLast((route) => route.name === "Thread");
      if (
        !parent?.params ||
        !("environmentId" in parent.params) ||
        parent.params.environmentId !== source.environmentId ||
        !("threadId" in parent.params) ||
        parent.params.threadId !== source.threadId
      )
        return false;
      const inspector = (parent.params as ReactNavigation.RootParamList["Thread"])?.inspector;
      if (
        state?.routes[state.index]?.key === parent.key &&
        inspector?.type === target.type &&
        inspector.environmentId === target.environmentId &&
        inspector.threadId === target.threadId &&
        inspector.deviceKey === target.deviceKey
      ) {
        return true;
      }
      navigation.dispatch(
        StackActions.popTo("Thread", { ...source, inspector: target }, { merge: true }),
      );
    }
    return true;
  };
}
