import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom } from "../../../../state/preferences";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../../../persistence/mobile-preferences";
import { ScrollView, type StyleProp, type TextStyle, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../../components/ui/AppText";
import {
  resolveMarkdownFontSizes,
  resolveMobileCodeSurface,
} from "../../../../lib/appearancePreferences";
import { getMobileTerminalTheme } from "../../../terminal/terminalTheme";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";

export function AppearancePreviewSeparator() {
  return <View className="h-px bg-separator" />;
}

export function TextAppearancePreview(props: { readonly fontSize: number }) {
  const translator = useMobileInterfaceTranslator();
  const sizes = resolveMarkdownFontSizes(props.fontSize);
  const { fontFamilies } = useAppearancePreferences();

  return (
    <View className="gap-1 p-4">
      <Text
        className="text-foreground"
        style={{
          fontFamily: fontFamilies.sans,
          fontSize: sizes.m,
          lineHeight: sizes.bodyLineHeight,
        }}
      >
        {translator.message("mobile.ui.theQuickBrownFoxJumpsOverThe")}
      </Text>
      <Text
        className="text-foreground-muted"
        style={{ fontSize: sizes.s, lineHeight: Math.round(sizes.s * 1.4) }}
      >
        {translator.message("mobile.ui.messagesLabelsAndHeadingsScaleWithThis")}
      </Text>
      <AppTextInput
        multiline
        accessibilityLabel={translator.message("mobile.prefs.fontFamilyComposer")}
        placeholder={translator.message("mobile.prefs.composerSample")}
        defaultValue={translator.message("mobile.prefs.samplePrompt")}
        style={{
          fontFamily: fontFamilies.composer,
          fontSize: sizes.m,
          lineHeight: sizes.bodyLineHeight,
        }}
      />
    </View>
  );
}

export function TerminalAppearancePreview(props: { readonly fontSize: number }) {
  const translator = useMobileInterfaceTranslator();
  const { themeAppearance: scheme, themeId, fontFamilies } = useAppearancePreferences();
  const theme = getMobileTerminalTheme(themeId, scheme);
  const lineHeight = Math.round(props.fontSize * 1.6);
  const lineStyle = {
    fontFamily: fontFamilies.terminal,
    fontSize: props.fontSize,
    lineHeight,
  } as const;
  const span = (color: string, extra?: TextStyle): StyleProp<TextStyle> => [
    lineStyle,
    { color, ...extra },
  ];

  return (
    <View className="p-4">
      <Text style={span(theme.foreground)}>
        <Text style={span(theme.palette[2])}>→ </Text>
        <Text style={span(theme.palette[6])}>t3code </Text>
        <Text style={span(theme.palette[4])}>git:(</Text>
        <Text style={span(theme.palette[1])}>main</Text>
        <Text style={span(theme.palette[4])}>)</Text>
        <Text style={span(theme.palette[3])}> ✗</Text>
        <Text style={span(theme.foreground)}> vpr dev</Text>
      </Text>
      <Text style={span(theme.foreground)}>
        <Text style={span(theme.palette[2])}>{translator.message("mobile.ui.viteV711")}</Text>
        <Text style={span(theme.mutedForeground)}> ready in</Text>
        <Text style={span(theme.foreground)}> 1.24s</Text>
      </Text>
      <Text style={span(theme.foreground)}>
        <Text style={span(theme.palette[2])}>→ </Text>
        <Text style={span(theme.mutedForeground)}>{translator.message("mobile.ui.local")} </Text>
        <Text style={span(theme.palette[6], { textDecorationLine: "underline" })}>
          http://127.0.0.1:5173/
        </Text>
      </Text>
      <Text style={span(theme.foreground)}>
        <Text style={span(theme.palette[2])}>✓ 85 passed</Text>
        <Text style={span(theme.palette[3])}> △ 2 warnings</Text>
        <Text style={span(theme.palette[1])}> ✗ 0 failed</Text>
      </Text>
      <Text style={span(theme.foreground)}>
        <Text style={span(theme.background, { backgroundColor: theme.palette[2] })}>
          {" READY "}
        </Text>
        <Text style={span(theme.mutedForeground)}> watching for changes</Text>{" "}
        <Text style={span(theme.cursorForeground)}>▏</Text>
      </Text>
    </View>
  );
}

interface CodePreviewToken {
  readonly text: string;
  readonly keyword?: boolean;
}

interface CodePreviewLine {
  readonly id: string;
  readonly tokens: ReadonlyArray<CodePreviewToken>;
  readonly change?: "add" | "remove";
}

const CODE_PREVIEW_LINES: ReadonlyArray<CodePreviewLine> = [
  {
    id: "signature",
    tokens: [{ text: "function", keyword: true }, { text: " formatUser(user) {" }],
  },
  { id: "before", change: "remove", tokens: [{ text: "  return user.name;" }] },
  { id: "after", change: "add", tokens: [{ text: "  return `${user.name} <${user.email}>`;" }] },
  { id: "close", tokens: [{ text: "}" }] },
];

export function CodeAppearancePreview(props: {
  readonly fontSize: number;
  readonly wordBreak: boolean;
}) {
  const surface = resolveMobileCodeSurface(props.fontSize);
  const { fontFamilies, themeAppearance } = useAppearancePreferences();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const scheme = AsyncResult.isSuccess(preferences)
    ? (preferences.value.diffColorScheme ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.diffColorScheme)
    : MOBILE_CLIENT_PREFERENCE_DEFAULTS.diffColorScheme;
  const colors =
    scheme === "blue-orange"
      ? {
          add: themeAppearance === "dark" ? "#93c5fd" : "#1d4ed8",
          remove: themeAppearance === "dark" ? "#fdba74" : "#9a3412",
        }
      : {
          add: themeAppearance === "dark" ? "#86efac" : "#166534",
          remove: themeAppearance === "dark" ? "#fca5a5" : "#991b1b",
        };

  const lineNumber = (line: CodePreviewLine, index: number) => (
    <Text
      className="text-right text-icon-subtle"
      key={line.id}
      style={{
        fontFamily: fontFamilies.code,
        fontSize: surface.lineNumberFontSize,
        lineHeight: surface.rowHeight,
        width: 22,
      }}
    >
      {line.change === "add" ? "+" : line.change === "remove" ? "−" : index + 1}
    </Text>
  );

  const codeLine = (line: CodePreviewLine, wrap: boolean) => (
    <Text
      className="text-foreground"
      key={line.id}
      numberOfLines={wrap ? undefined : 1}
      style={{
        fontFamily: fontFamilies.code,
        fontSize: surface.fontSize,
        lineHeight: surface.rowHeight,
        ...(line.change
          ? { color: colors[line.change], backgroundColor: `${colors[line.change]}18` }
          : {}),
      }}
    >
      {line.tokens.map((token) => (
        <Text
          key={token.text}
          className={token.keyword && !line.change ? "text-md-link" : undefined}
          style={{
            fontFamily: fontFamilies.code,
            fontSize: surface.fontSize,
            lineHeight: surface.rowHeight,
            ...(line.change ? { color: colors[line.change] } : {}),
          }}
        >
          {token.text}
        </Text>
      ))}
    </Text>
  );

  if (props.wordBreak) {
    return (
      <View className="p-4">
        {CODE_PREVIEW_LINES.map((line, index) => (
          <View className="flex-row" key={line.id}>
            {lineNumber(line, index)}
            <View className="flex-1 pl-3">{codeLine(line, true)}</View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View className="flex-row p-4">
      <View>{CODE_PREVIEW_LINES.map((line, index) => lineNumber(line, index))}</View>
      <ScrollView
        horizontal
        contentContainerStyle={{ paddingLeft: 12 }}
        showsHorizontalScrollIndicator={false}
      >
        <View>{CODE_PREVIEW_LINES.map((line) => codeLine(line, false))}</View>
      </ScrollView>
    </View>
  );
}
