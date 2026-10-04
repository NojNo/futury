import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "futury-test-"));
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "futury-test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0]!.text;
}

export function jsonOf<T = Record<string, unknown>>(result: unknown): T {
  return JSON.parse(textOf(result)) as T;
}

export const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
