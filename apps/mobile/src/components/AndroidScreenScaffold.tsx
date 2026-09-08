import { useNavigation } from "@react-navigation/native";
import { useCallback, type ComponentProps, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader, type AndroidHeaderAction } from "./AndroidScreenHeader";
import {
  resolveAndroidScreenHeaderVariant,
  resolveNavigationUpAction,
  resolveScreenContentBottomPadding,
  type AndroidScreenHeaderVariant,
} from "./AndroidScreenScaffold.logic";
import { cn } from "../lib/cn";
import { NativeStackScreenOptions } from "../native/StackHeader";

export interface AndroidScreenScaffoldProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly subtitle?: string | null;
  readonly actions?: ReadonlyArray<AndroidHeaderAction>;
  readonly trailing?: ReactNode;
  readonly variant?: AndroidScreenHeaderVariant;
  readonly onNavigateUp?: () => void;
  readonly className?: string;
}

/** Provides in-flow Android chrome while leaving native iOS headers untouched. */
export function AndroidScreenScaffold(props: AndroidScreenScaffoldProps) {
  const navigation = useNavigation();
  const navigateUp = useCallback(() => {
    const action = resolveNavigationUpAction(navigation.canGoBack());
    if (action === "back") {
      navigation.goBack();
      return;
    }
    navigation.navigate("Home");
  }, [navigation]);
  const headerVariant = resolveAndroidScreenHeaderVariant(Platform.OS, props.variant ?? "page");

  return (
    <View collapsable={false} className={cn("flex-1 bg-sheet", props.className)}>
      {headerVariant ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            actions={props.actions}
            embedded={headerVariant === "sheet"}
            onBack={props.onNavigateUp ?? navigateUp}
            subtitle={props.subtitle}
            title={props.title}
            trailing={props.trailing}
          />
        </>
      ) : null}
      {props.children}
    </View>
  );
}

type StyledScrollViewProps = ComponentProps<typeof ScrollView> & {
  readonly className?: string;
  readonly contentContainerClassName?: string;
};

type ScreenScaffoldScrollViewProps = Omit<
  StyledScrollViewProps,
  "contentInsetAdjustmentBehavior" | "showsVerticalScrollIndicator"
>;

/** Keeps form-like screen content clear of the home indicator and navigation bar. */
export function ScreenScaffoldScrollView(props: ScreenScaffoldScrollViewProps) {
  const insets = useSafeAreaInsets();
  const { className, contentContainerClassName, contentContainerStyle, ...scrollViewProps } = props;

  return (
    <ScrollView
      {...scrollViewProps}
      className={cn("flex-1", className)}
      contentContainerClassName={cn("gap-6 px-5 pt-4", contentContainerClassName)}
      contentContainerStyle={[
        contentContainerStyle,
        { paddingBottom: resolveScreenContentBottomPadding(insets.bottom) },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    />
  );
}
