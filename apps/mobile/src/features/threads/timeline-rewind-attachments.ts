import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { COMPOSER_ATTACHMENT_DIRECTORY } from "../../lib/composerAttachmentFiles";
import { uuidv4 } from "../../lib/uuid";
import { refreshAssetUrl } from "../../state/assets";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export async function prepareTimelineRewindAttachments(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ChatAttachment>,
): Promise<ReadonlyArray<DraftComposerAttachment>> {
  if (attachments.length === 0) return [];
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, COMPOSER_ATTACHMENT_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const files: InstanceType<typeof File>[] = [];
  const restored: DraftComposerAttachment[] = [];
  try {
    for (const attachment of attachments) {
      const url = await refreshAssetUrl(environmentId, {
        _tag: "attachment",
        attachmentId: attachment.id,
        fileName: attachment.name,
        mimeType: attachment.mimeType,
      });
      if (!url)
        throw new Error(
          currentInterfaceTranslator().message("mobile.timeline.attachmentUnavailable"),
        );
      const file = new File(directory, `${uuidv4()}-${attachment.name.replace(/[^\w.-]/g, "_")}`);
      files.push(file);
      await File.downloadFileAsync(url, file);
      const common = {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        fileUri: file.uri,
      };
      restored.push(
        attachment.type === "image"
          ? { ...common, type: "image", previewUri: file.uri }
          : { ...common, type: "file" },
      );
    }
    return restored;
  } catch (cause) {
    for (const file of files) if (file.exists) file.delete();
    throw cause;
  }
}
