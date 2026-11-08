// A follower cannot enqueue directly (enqueue rejects that stream role).
// Let the existing TurnCoordinator forward its local queue to the owner instead.
// Rename the shadowing thread parameter so the predicate can read the manager.
const start = 'canEnqueue:(e,n)=>!t||g(e,n)';
const replacement = 'canEnqueue:(threadId,n)=>e.getStreamRole(threadId)?.role!==`follower`&&(!t||g(threadId,n)';
const end = '&&n.writingBlockAdditionalContext==null,findByClientMessageId:';
const patchedEnd = '&&n.writingBlockAdditionalContext==null),findByClientMessageId:';
function patchQueue(source) {
    if (source.includes(replacement)) return source;
    if (!source.includes(start)) return source;
    if (source.split(start).length !== 2 || source.split(end).length !== 2)
        throw new Error('Unsupported Codex queue admission predicate');
    return source.replace(start, replacement).replace(end, patchedEnd);
}
module.exports = {start, replacement, patchQueue};
