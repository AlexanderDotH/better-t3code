import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { AssemblyAiDictationState } from "../../hooks/useAssemblyAiDictation";
import { VoiceDictationControl } from "./VoiceDictationControl";

function DictationControls({
  disabled,
  state,
}: {
  disabled: boolean;
  state: AssemblyAiDictationState;
}) {
  const [draft, setDraft] = useState("Processed words");
  return (
    <>
      <VoiceDictationControl
        state={state}
        disabled={disabled}
        audioWaveform={[0, 0.3, 0.6, 1]}
        onStart={() => setDraft("Recording")}
        onStop={() => setDraft("Transcribed words")}
        onCancel={() => setDraft("Draft before recording")}
        onRestoreOriginal={() => setDraft("Original words")}
      />
      <output aria-label="Draft">{draft}</output>
    </>
  );
}

it("protects a locked draft but keeps cancellation available during voice processing", async () => {
  // Voice controls do not navigate.
  await using screen = await render(<DictationControls disabled state="idle" />, {
    router: false,
  });
  await expect.element(screen.getByRole("button", { name: "Start voice input" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Restore original" })).toBeDisabled();
  await screen.rerender(<DictationControls disabled={false} state="idle" />);
  await userEvent.click(screen.getByRole("button", { name: "Restore original" }));
  await expect.element(screen.getByLabelText("Draft")).toHaveTextContent("Original words");

  await screen.rerender(<DictationControls disabled state="starting" />);
  await userEvent.click(screen.getByRole("button", { name: "Cancel voice input connection" }));
  await expect.element(screen.getByLabelText("Draft")).toHaveTextContent("Draft before recording");

  await screen.rerender(<DictationControls disabled state="recording" />);
  await userEvent.click(screen.getByRole("button", { name: "Stop voice input" }));
  await expect.element(screen.getByLabelText("Draft")).toHaveTextContent("Transcribed words");
  await screen.rerender(<DictationControls disabled state="stopping" />);
  await expect
    .element(screen.getByRole("button", { name: "Processing voice input…" }))
    .toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel voice input", exact: true }));
  await expect.element(screen.getByLabelText("Draft")).toHaveTextContent("Draft before recording");
});
