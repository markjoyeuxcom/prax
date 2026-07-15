export function createTaskMutationQueue() {
  const tails = new Map();

  return function enqueueTaskMutation(taskId, operation) {
    const prior = tails.get(taskId) || Promise.resolve();
    const run = prior.catch(() => {}).then(operation);
    tails.set(taskId, run);
    return run.finally(() => {
      if (tails.get(taskId) === run) tails.delete(taskId);
    });
  };
}
