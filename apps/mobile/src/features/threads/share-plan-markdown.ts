import { File, Paths } from "expo-file-system";
import { isAvailableAsync } from "expo-sharing";
import { Share } from "react-native";
import { shareFileFromSource } from "../../lib/shareFileFromSource";
import { uuidv4 } from "../../lib/uuid";

export async function sharePlanMarkdown(markdown: string) {
  if (!(await isAvailableAsync())) {
    await Share.share({ message: markdown });
    return;
  }
  const file = new File(Paths.cache, `plan-${uuidv4()}.md`);
  try {
    file.create();
    await file.write(markdown);
    await shareFileFromSource(
      file.uri,
      { mimeType: "text/markdown", UTI: "net.daringfireball.markdown" },
      file.uri,
    );
  } finally {
    if (file.exists) file.delete();
  }
}
