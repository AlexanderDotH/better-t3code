import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";
import type { ComponentProps } from "react";
import { FloatingActionButton } from "./ui/FloatingActionButton.android";
import { ScrollComposeButton } from "./ScrollComposeButton.android";
import type { NewThreadButton as SharedNewThreadButton } from "./NewThreadButton.shared";

export function NewThreadButton(props: ComponentProps<typeof SharedNewThreadButton>) {
  const translator = useMobileInterfaceTranslator();
  if (props.extended && props.expanded !== undefined) {
    return <ScrollComposeButton {...props} expanded={props.expanded} />;
  }
  return (
    <FloatingActionButton
      {...props}
      icon="square.and.pencil"
      label={translator.message("sidebar.thread.new")}
      tone="primary"
      variant={props.extended ? "extended" : "large"}
    />
  );
}
