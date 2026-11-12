import { getProjectOrderKey } from "@t3tools/client-runtime/state/project-grouping";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { PROJECT_SORT_OPTIONS } from "./home-list-sort-options";
import {
  reorderHomeProjectKeys,
  sortHomeProjectScopes,
  type HomeProjectScope,
} from "./homeThreadList";

function orderedProjectScopes(
  scopes: ReadonlyArray<HomeProjectScope>,
  projectOrder?: ReadonlyArray<string>,
) {
  return [
    ...sortHomeProjectScopes({
      scopes: scopes.filter((scope) => !scope.archived),
      threads: [],
      pendingTasks: [],
      projectSortOrder: "manual",
      projectOrder,
    }),
  ].sort((first, second) => Number(second.pinned) - Number(first.pinned));
}

export function ProjectOrderMenu(props: { readonly scopes: ReadonlyArray<HomeProjectScope> }) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : {};
  const save = useAtomSet(updateMobilePreferencesAtom);
  const [open, setOpen] = useState(false);
  const ordered = orderedProjectScopes(props.scopes, preferences.sidebarProjectOrder);
  return (
    <>
      <Menu
        actions={[
          ...PROJECT_SORT_OPTIONS.map((option) => ({
            id: option.value,
            title: option.label,
            state:
              (preferences.sidebarProjectSortOrder ?? "updated_at") === option.value
                ? ("on" as const)
                : ("off" as const),
          })),
          { id: "reorder", title: translator.message("mobile.home.reorderProjects") },
        ]}
        onPressAction={({ nativeEvent }) => {
          const value = PROJECT_SORT_OPTIONS.find(
            (option) => option.value === nativeEvent.event,
          )?.value;
          if (value) save({ sidebarProjectSortOrder: value });
          if (nativeEvent.event === "reorder") setOpen(true);
        }}
      >
        <View accessible accessibilityRole="button" className="min-h-11 justify-center px-4">
          <AppText className="text-sm text-foreground-muted">
            {translator.message("mobile.navigation.sortProjects")}
          </AppText>
        </View>
      </Menu>
      {open ? (
        <Modal
          visible
          presentationStyle="pageSheet"
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <View
            className="flex-1 bg-screen"
            style={{
              paddingTop: Platform.OS === "android" ? insets.top : 0,
              paddingBottom: insets.bottom,
            }}
          >
            <SheetHeader
              presentation="inline"
              title={translator.message("mobile.home.reorderProjects")}
              onClose={() => setOpen(false)}
            />
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {ordered.map((scope, index) => (
                <View key={scope.key} className="gap-2 rounded-xl bg-subtle p-3">
                  <AppText className="font-t3-semibold">{scope.title}</AppText>
                  <View className="flex-row gap-3">
                    {(["up", "down"] as const).map((direction) => (
                      <Button
                        key={direction}
                        label={translator.message(
                          direction === "up" ? "mobile.thread.moveUp" : "mobile.thread.moveDown",
                        )}
                        icon={direction === "up" ? "arrow.up" : "arrow.down"}
                        disabled={
                          ordered[index + (direction === "up" ? -1 : 1)]?.pinned !== scope.pinned
                        }
                        onPress={() =>
                          save({
                            transform: (current) => {
                              const currentOrder = orderedProjectScopes(
                                props.scopes,
                                current.sidebarProjectOrder,
                              ).map((group) => group.key);
                              const scopeByKey = new Map(
                                props.scopes.map((group) => [group.key, group]),
                              );
                              const reordered = reorderHomeProjectKeys(
                                currentOrder,
                                scope.key,
                                direction,
                              ).flatMap(
                                (key) =>
                                  scopeByKey.get(key)?.projects.map(getProjectOrderKey) ?? [],
                              );
                              const visibleKeys = new Set([...currentOrder, ...reordered]);
                              return {
                                sidebarProjectSortOrder: "manual",
                                sidebarProjectOrder: [
                                  ...new Set(reordered),
                                  ...(current.sidebarProjectOrder ?? []).filter(
                                    (key) => !visibleKeys.has(key),
                                  ),
                                ],
                              };
                            },
                          })
                        }
                      />
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
