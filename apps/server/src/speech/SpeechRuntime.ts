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
const speechContext = Layer.mergeAll(
  ProjectSpeechProfiles.layer,
  AssemblyAiStreamingTokenLive,
).pipe(Layer.provideMerge(speechData));

export const layer = Layer.mergeAll(AssemblyAiDictation.layer, ProjectTextTransforms.layer).pipe(
  Layer.provideMerge(speechContext),
);
