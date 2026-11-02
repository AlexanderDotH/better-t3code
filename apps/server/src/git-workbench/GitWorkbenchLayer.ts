import * as Layer from "effect/Layer";

import * as GitWorkbenchUndoStorage from "../persistence/Layers/GitWorkbenchUndoStorage.ts";
import * as GitRepositoryQueryService from "./GitRepositoryQueryService.ts";
import * as GitRebaseControlledEditor from "./GitRebaseControlledEditor.ts";
import * as GitWorkbenchDriver from "./GitWorkbenchDriver.ts";
import * as GitWorkbenchOperations from "./GitWorkbenchOperations.ts";
import * as GitWorkbenchQueueRepository from "./GitWorkbenchQueueRepository.ts";
import * as GitWorkbenchQueueService from "./GitWorkbenchQueueService.ts";
import * as GitWorkbenchQueueReactor from "./GitWorkbenchQueueReactor.ts";
import * as GitWorkbenchRuntime from "./GitWorkbenchRuntime.ts";
import * as GitWorkbenchService from "./GitWorkbenchService.ts";
import * as GitWorkbenchUndoDriver from "./GitWorkbenchUndoDriver.ts";
import * as GitWorkbenchUndoService from "./GitWorkbenchUndoService.ts";
import * as TurnQuiescenceNotifier from "./TurnQuiescenceNotifier.ts";

const foundation = Layer.mergeAll(
  GitWorkbenchRuntime.GitWorkbenchMutationSchedulerLive,
  GitWorkbenchDriver.layer,
  GitRepositoryQueryService.layer,
  GitWorkbenchOperations.driverLayer,
  GitRebaseControlledEditor.layer,
  GitWorkbenchUndoStorage.GitWorkbenchUndoStorageLive,
  GitWorkbenchQueueRepository.GitWorkbenchQueueRepositoryLive,
  TurnQuiescenceNotifier.TurnQuiescenceNotifierLive,
);

const stateReaders = Layer.mergeAll(
  GitWorkbenchRuntime.GitWorkbenchOperationStateReaderLive,
  GitWorkbenchRuntime.GitWorkbenchUndoStateReaderLive,
).pipe(Layer.provideMerge(foundation));

const undo = GitWorkbenchUndoService.layer.pipe(
  Layer.provideMerge(GitWorkbenchUndoDriver.layer.pipe(Layer.provideMerge(foundation))),
  Layer.provideMerge(stateReaders),
);

const operations = GitWorkbenchOperations.layer.pipe(
  Layer.provideMerge(undo),
  Layer.provideMerge(stateReaders),
);

const queue = GitWorkbenchQueueService.GitWorkbenchQueueLive.pipe(
  Layer.provideMerge(
    GitWorkbenchRuntime.GitWorkbenchQueueRuntimeLive.pipe(Layer.provideMerge(operations)),
  ),
);

export const layer = GitWorkbenchService.layer.pipe(
  Layer.provideMerge(
    GitWorkbenchQueueReactor.GitWorkbenchQueueReactorWorkerLive.pipe(
      Layer.provideMerge(GitWorkbenchQueueReactor.GitWorkbenchQueueReactorLive),
      Layer.provideMerge(queue),
    ),
  ),
  Layer.provideMerge(TurnQuiescenceNotifier.workerLayer.pipe(Layer.provide(foundation))),
  Layer.provideMerge(queue),
);
