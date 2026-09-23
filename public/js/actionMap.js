// Feature controllers expose their data-action handlers as a map
// { 'action-name': (el, event, action) => … } that handleAction consults
// before its own switch. A handler that serves several actions (the former
// fall-through `case 'a': case 'b':`) is registered under each name and
// reads which one fired from its third argument.
export function sharedAction(...namesAndHandler) {
  const handler = namesAndHandler.pop();
  return Object.fromEntries(namesAndHandler.map(name => [name, handler]));
}
