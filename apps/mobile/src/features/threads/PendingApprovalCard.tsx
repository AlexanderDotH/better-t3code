import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import type { PendingApproval } from "../../lib/threadActivity";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export interface PendingApprovalCardProps {
  readonly approval: PendingApproval;
  readonly respondingApprovalId: ApprovalRequestId | null;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const translator = useMobileInterfaceTranslator();
  const options: ReadonlyArray<ProviderApprovalOption> = props.approval.options ?? [
    { decision: "accept", label: translator.message("mobile.thread.allowOnce") },
    { decision: "acceptForSession", label: translator.message("mobile.thread.allowSession") },
    { decision: "decline", label: translator.message("mobile.thread.decline") },
  ];
  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-[20px] border border-adaptive-neutral-200-white-a6 bg-adaptive-neutral-100-900 p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-adaptive-sky-700-300">
        {translator.message("mobile.thread.approvalNeeded")}
      </Text>
      <Text className="font-t3-bold text-lg text-adaptive-neutral-950-50">
        {props.approval.appName ?? props.approval.requestKind}
      </Text>
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-adaptive-neutral-600-400">
          {props.approval.detail}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2.5">
        {options.map((option) => (
          <Pressable
            key={option.decision}
            className={`items-center justify-center rounded-[14px] px-3.5 py-3 ${
              option.decision === "accept"
                ? "bg-blue-500"
                : option.decision === "decline"
                  ? "bg-adaptive-rose-100-500-a18"
                  : "bg-adaptive-neutral-200-800"
            }`}
            disabled={props.respondingApprovalId === props.approval.requestId}
            onPress={() => void props.onRespond(props.approval.requestId, option.decision)}
          >
            <Text
              className={`text-sm ${
                option.decision === "accept"
                  ? "font-t3-extrabold text-white"
                  : option.decision === "decline"
                    ? "font-t3-bold text-adaptive-rose-700-300"
                    : "font-t3-bold text-adaptive-neutral-950-50"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
