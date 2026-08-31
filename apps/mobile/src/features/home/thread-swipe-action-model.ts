export interface ThreadSwipeMenuModel<MenuAction, MenuEvent> {
  readonly actions: MenuAction[];
  readonly onPressAction: (event: MenuEvent) => void;
  readonly title?: string;
}

export interface ThreadSwipeActionModel<Icon, MenuAction, MenuEvent> {
  readonly accessibilityLabel: string;
  readonly icon: Icon;
  readonly label: string;
  readonly menu?: ThreadSwipeMenuModel<MenuAction, MenuEvent>;
  readonly onPress: () => void;
}

export interface ThreadSwipeSecondaryActionModel<
  Icon,
  MenuAction,
  MenuEvent,
> extends ThreadSwipeActionModel<Icon, MenuAction, MenuEvent> {
  readonly backgroundColor: string;
}

export function resolveThreadSwipeSecondaryAction<Icon, MenuAction, MenuEvent>(input: {
  readonly close: () => void;
  readonly deleteAccessibilityLabel: string;
  readonly deleteIcon: Icon;
  readonly deleteLabel: string;
  readonly onDelete: () => void;
  readonly secondaryAction: ThreadSwipeActionModel<Icon, MenuAction, MenuEvent> | null | undefined;
}): ThreadSwipeSecondaryActionModel<Icon, MenuAction, MenuEvent> | null {
  if (input.secondaryAction === null) return null;
  if (input.secondaryAction === undefined) {
    return {
      accessibilityLabel: input.deleteAccessibilityLabel,
      backgroundColor: "#ff2d55",
      icon: input.deleteIcon,
      label: input.deleteLabel,
      onPress: () => {
        input.close();
        input.onDelete();
      },
    };
  }
  const action = input.secondaryAction;
  return {
    ...action,
    backgroundColor: "#5856d6",
    menu:
      action.menu === undefined
        ? undefined
        : {
            ...action.menu,
            onPressAction: (event) => {
              input.close();
              action.menu?.onPressAction(event);
            },
          },
    onPress: () => {
      input.close();
      action.onPress();
    },
  };
}
