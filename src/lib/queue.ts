import type { ProcessorQueueMessage } from '../types';

/**
 * Send message to processor queue
 */
export async function sendToProcessorQueue(
  queue: Queue,
  message: ProcessorQueueMessage
): Promise<void> {
  await queue.send(message);
}

/**
 * Batch send messages to processor queue
 */
export async function batchSendToProcessorQueue(
  queue: Queue,
  messages: ProcessorQueueMessage[]
): Promise<void> {
  if (messages.length === 0) return;
  await queue.sendBatch(messages.map(msg => ({ body: msg })));
  console.warn(`📤 Sent ${messages.length} messages to processor queue`);
}
