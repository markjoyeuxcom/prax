// Archive/restore are state-setting operations. Read canonical state after an
// interrupted response before describing either outcome to the person.
export async function reconcileTaskArchive({ id, archived = true, mutate, read }) {
  try { return { committed:true, task:await mutate(id), outcome:'committed' }; }
  catch {
    try {
      const task = await read(id);
      return Boolean(task?.archivedAt) === archived
        ? { committed:true, task, outcome:'reconciled' }
        : { committed:false, task, outcome:'failed' };
    } catch { return { committed:false, task:null, outcome:'unknown' }; }
  }
}
