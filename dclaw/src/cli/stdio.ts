export async function readStdinIfPiped(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }

  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text.length > 0 ? text : undefined
}

