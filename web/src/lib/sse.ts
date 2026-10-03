// Reads server-sent events from a fetch() response body. EventSource would do this for
// us, but it can only make GET requests, and asking a question is a POST.
//
// Follows the SSE format: "field: value" lines, an empty line ends an event, lines
// starting with ":" are comments (the server's heartbeats). Network chunks can split a
// line or an event anywhere, so text is buffered until a whole line has arrived.

export type ServerEvent = { event: string; data: string };

const LINE_END = /\r\n|\r|\n/;

export async function* readServerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  // stream: true keeps a multi-byte character split across two chunks intact.
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message"; // the spec's default event name
  let data: string[] = [];

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return; // an unfinished event at the very end is dropped, as the spec says
      buffer += decoder.decode(value, { stream: true });

      for (let match = LINE_END.exec(buffer); match; match = LINE_END.exec(buffer)) {
        // A lone "\r" at the end might be the first half of "\r\n": wait for more text.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (line === "") {
          if (data.length > 0) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const fieldValue = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") event = fieldValue;
          else if (field === "data") data.push(fieldValue);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
