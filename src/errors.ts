// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";

// Errors Futury reports to the user as tool errors; `location` names the variable or file.
export abstract class FuturyError extends Error {
  abstract readonly location: string;
}

export class ConfigError extends FuturyError {
  constructor(readonly variable: string) {
    super(`${variable} must be an absolute path`);
    this.name = "ConfigError";
  }

  get location(): string {
    return this.variable;
  }
}

abstract class FileError extends FuturyError {
  constructor(label: string, readonly path: string, reason: string) {
    super(`${label} ${path}: ${reason}`);
  }

  get location(): string {
    return this.path;
  }
}

export class MentorFileError extends FileError {
  constructor(path: string, reason: string) {
    super("Mentor file", path, reason);
    this.name = "MentorFileError";
  }
}

export class ProfileFileError extends FileError {
  constructor(path: string, reason: string) {
    super("Profile file", path, reason);
    this.name = "ProfileFileError";
  }
}

export function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "unknown";
}

export function absolutePathFromEnv(env: NodeJS.ProcessEnv, variable: string, fallback: () => string): string {
  const value = env[variable];
  if (value === undefined || value === "") return fallback();
  if (!isAbsolute(value)) throw new ConfigError(variable);
  return value;
}
