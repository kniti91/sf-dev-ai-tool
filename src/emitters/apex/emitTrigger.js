export default function emitTrigger(entry) {
  const lines = [];

  lines.push(`trigger ${entry.name} on ${entry.sobject} (${entry.events.join(', ')}) {`);
  lines.push(`  ${entry.handlerClass}.execute(Trigger.new);`);
  lines.push(`}`);

  return lines.join('\n');
}
