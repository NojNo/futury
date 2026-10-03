import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const SERVER = resolve("dist/server.js");

describe("stdio smoke test", () => {
  it("starts from an unrelated directory, answers over stdio and keeps stdout protocol-only", async () => {
    if (!existsSync(SERVER)) throw new Error("dist/server.js missing: run `npm run build` (npm test does this)");
    const cwd = await tempDir();
    const child = spawn(process.execPath, [SERVER], {
      cwd,
      env: { ...process.env, FUTURY_HOME: join(cwd, "home"), FUTURY_MENTORS_PATH: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutLines: string[] = [];
    let stderr = "";
    let buffer = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const response = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; stderr: ${stderr}`)), 10000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() === "") continue;
          stdoutLines.push(line);
          const message = JSON.parse(line) as { id?: number };
          if (message.id === 2) {
            clearTimeout(timer);
            resolveResponse(message as Record<string, unknown>);
          }
        }
      });
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_mentor", arguments: { challenge_category: "fundraising", stage: "seed" } } });

    const result = (await response).result as { content: { text: string }[] };
    child.kill();
    const found = JSON.parse(result.content[0]!.text) as { candidates: { mentor: { id: string } }[] };
    expect(found.candidates.map((c) => c.mentor.id)).toEqual(["m-001", "m-002"]);
    for (const line of stdoutLines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    expect(stderr).toMatch(/^futury \S+ home=\S+ mentors=\S+data\/mentors\.json/m);
  });
});
