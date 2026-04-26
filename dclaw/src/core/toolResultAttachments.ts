import { createMessage, type Message } from '../types/message.js'

export function createToolResultAttachmentMessages(
  messages: Message[],
): Message[] {
  const attachments: Message[] = []

  for (const message of messages) {
    for (const block of message.content) {
      if (
        block.type !== 'tool_result' ||
        !Array.isArray(block.content) ||
        block.content.length === 0 ||
        !block.content.some(item => item.type === 'image' || item.type === 'pdf')
      ) {
        continue
      }

      attachments.push(
        createMessage(
          'user',
          block.content.map(item =>
            item.type === 'text'
              ? {
                  type: 'text' as const,
                  text: item.text,
                  ...(item.annotations ? { annotations: item.annotations } : {}),
                }
              : item.type === 'image'
              ? {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    mediaType: item.source.mediaType,
                    data: item.source.data,
                  },
                }
              : {
                  type: 'pdf' as const,
                  source: {
                    type: 'base64' as const,
                    mediaType: item.source.mediaType,
                    data: item.source.data,
                  },
                  ...(item.filename ? { filename: item.filename } : {}),
                },
          ),
        ),
      )
    }
  }

  return attachments
}
