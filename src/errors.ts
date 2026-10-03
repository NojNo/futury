export class ConfigError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} must be an absolute path`);
    this.name = "ConfigError";
  }
}

export class MentorFileError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Mentor file ${path}: ${reason}`);
    this.name = "MentorFileError";
  }
}

export class ProfileFileError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Profile file ${path}: ${reason}`);
    this.name = "ProfileFileError";
  }
}
