import * as Layer from "effect/Layer";

import * as AssemblyAiDictation from "./AssemblyAiDictation.ts";
import { AssemblyAiStreamingTokenLive } from "./Layers/AssemblyAiStreamingToken.ts";
import * as ProjectSpeechProfileStore from "./ProjectSpeechProfileStore.ts";
import * as ProjectSpeechProfiles from "./ProjectSpeechProfiles.ts";
import * as ProjectSpeechVocabulary from "./ProjectSpeechVocabulary.ts";
import * as ProjectSpeechWorkspaceScanner from "./ProjectSpeechWorkspaceScanner.ts";
import * as ProjectTextTransforms from "./ProjectTextTransforms.ts";

const speechData = Layer.mergeAll(
  ProjectSpeechProfileStore.layer,
  ProjectSpeechVocabulary.layer.pipe(Layer.provideMerge(ProjectSpeechWorkspaceScanner.layer)),
);

export const layer = Layer.mergeAll(
  ProjectSpeechProfiles.layer,
  AssemblyAiDictation.layer,
  AssemblyAiStreamingTokenLive,
  ProjectTextTransforms.layer,
).pipe(Layer.provideMerge(speechData));
