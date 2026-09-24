import type {
  EnvironmentId,
  ProjectIndexScopeInput,
  ProjectSourceRangeV1,
} from "@t3tools/contracts";
import { useState } from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useProject, useThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { SourceFileSurface } from "../files/SourceFileSurface";
import { ProjectIndexActionButton } from "./ProjectIndexControls";
import { mobileProjectIndexSourceRequest } from "./mobile-project-indexing";

interface SourceProps {
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly source: { readonly filePath: string; readonly range: ProjectSourceRangeV1 };
}

function ProjectIndexSourceModal(props: SourceProps & { readonly onClose: () => void }) {
  const translator = useMobileInterfaceTranslator();
  const project = useProject({
    environmentId: props.environmentId,
    projectId: props.scope.projectId,
  });
  const thread = useThreadShell(
    props.scope.threadId
      ? { environmentId: props.environmentId, threadId: props.scope.threadId }
      : null,
  );
  const request = mobileProjectIndexSourceRequest({ ...props, project, thread });
  const file = useEnvironmentQuery(request ? projectEnvironment.readFile(request) : null);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={props.onClose}
    >
      <SafeAreaView className="flex-1 bg-sheet" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Text
            className="min-w-0 flex-1 text-sm font-t3-semibold text-foreground"
            numberOfLines={2}
          >
            {props.source.filePath}:{props.source.range.startLine}
          </Text>
          <ProjectIndexActionButton
            label={translator.message("common.close")}
            onPress={props.onClose}
          />
        </View>
        {request === null || file.error ? (
          <EmptyState
            title={translator.message("knowledgeGraph.openSource")}
            detail={file.error ?? translator.message("knowledgeGraph.sourceUnavailable")}
            actionLabel={translator.message("projectIndexing.retry")}
            onAction={file.refresh}
            variant="plain"
          />
        ) : file.data ? (
          <View className="flex-1">
            {file.data.truncated ? (
              <Text className="border-b border-border p-3 text-xs text-foreground-muted">
                {translator.message("projectIndexing.sourceTruncated")}
              </Text>
            ) : null}
            <SourceFileSurface
              contents={file.data.contents}
              path={props.source.filePath}
              initialLine={props.source.range.startLine}
              onRefresh={file.refresh}
            />
          </View>
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export function ProjectIndexSourceButton(props: SourceProps) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ProjectIndexActionButton
        label={translator.message("knowledgeGraph.openSource")}
        onPress={() => setOpen(true)}
      />
      {open ? <ProjectIndexSourceModal {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
