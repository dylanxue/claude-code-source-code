function decodeEvent(rawEvent) {
  const lines = rawEvent.split("\n");
  const dataLines = [];
  let eventName = "message";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || eventName;
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return {
      event: eventName,
      data,
      payload: null,
    };
  }

  return {
    event: eventName,
    data,
    payload: JSON.parse(data),
  };
}

export async function collectSseEvents(stream, onEvent, { onChunk = null } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    onChunk?.(value);

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);

      if (!rawEvent) {
        continue;
      }

      const parsed = decodeEvent(rawEvent);
      if (parsed) {
        onEvent(parsed);
      }
    }
  }

  const remainder = buffer.trim();
  if (remainder) {
    const parsed = decodeEvent(remainder);
    if (parsed) {
      onEvent(parsed);
    }
  }
}
