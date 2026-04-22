import { describe, expect, it } from "vitest";

import { buildTransportTargets } from "../src/Logger.js";

describe("buildTransportTargets", () => {
  it("returns an empty target list for defaults (pino uses native stdout)", () => {
    const targets = buildTransportTargets({ name: "svc" });
    expect(targets).toEqual([]);
  });

  it("emits pino-pretty when pretty: true", () => {
    const targets = buildTransportTargets({ name: "svc", pretty: true });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.target).toBe("pino-pretty");
  });

  it("adds a stdout JSON target alongside file transports", () => {
    const targets = buildTransportTargets({
      name: "svc",
      transports: { files: ["/tmp/app.log"] },
    });
    const stdoutTarget = targets.find(
      (t) =>
        t.target === "pino/file" &&
        (t.options as { destination?: number } | undefined)?.destination === 1
    );
    const fileTarget = targets.find(
      (t) =>
        t.target === "pino/file" &&
        (t.options as { destination?: string } | undefined)?.destination === "/tmp/app.log"
    );
    expect(stdoutTarget).toBeDefined();
    expect(fileTarget).toBeDefined();
  });

  describe("syslog transport", () => {
    it("defaults to UDP on port 514", () => {
      const targets = buildTransportTargets({
        name: "svc",
        transports: { syslog: { host: "logs.example.com" } },
      });
      const socket = targets.find((t) => t.target === "pino-socket");
      expect(socket).toBeDefined();
      const opts = socket!.options as Record<string, unknown>;
      expect(opts.mode).toBe("udp");
      expect(opts.address).toBe("logs.example.com");
      expect(opts.port).toBe(514);
      expect(opts.secure).toBeUndefined();
    });

    it("uses plain TCP on port 514 when protocol is 'tcp'", () => {
      const targets = buildTransportTargets({
        name: "svc",
        transports: { syslog: { host: "logs.example.com", protocol: "tcp" } },
      });
      const socket = targets.find((t) => t.target === "pino-socket");
      const opts = socket!.options as Record<string, unknown>;
      expect(opts.mode).toBe("tcp");
      expect(opts.port).toBe(514);
      expect(opts.secure).toBeUndefined();
      expect(opts.reconnect).toBe(true);
    });

    it("wires real TLS (secure=true) when protocol is 'tls'", () => {
      const targets = buildTransportTargets({
        name: "svc",
        transports: { syslog: { host: "logs.papertrailapp.com", protocol: "tls" } },
      });
      const socket = targets.find((t) => t.target === "pino-socket");
      const opts = socket!.options as Record<string, unknown>;
      expect(opts.mode).toBe("tcp");
      expect(opts.secure).toBe(true);
      expect(opts.port).toBe(6514);
      // Certs must be verified by default
      expect(opts.noverify).toBeUndefined();
      expect(opts.reconnect).toBe(true);
    });

    it("respects an explicit port override for TLS", () => {
      const targets = buildTransportTargets({
        name: "svc",
        transports: {
          syslog: { host: "logs.example.com", protocol: "tls", port: 9514 },
        },
      });
      const socket = targets.find((t) => t.target === "pino-socket");
      expect((socket!.options as Record<string, unknown>).port).toBe(9514);
    });

    it("disables cert verification only when rejectUnauthorized is explicitly false", () => {
      const targets = buildTransportTargets({
        name: "svc",
        transports: {
          syslog: {
            host: "logs.example.com",
            protocol: "tls",
            rejectUnauthorized: false,
          },
        },
      });
      const socket = targets.find((t) => t.target === "pino-socket");
      expect((socket!.options as Record<string, unknown>).noverify).toBe(true);
    });
  });
});
