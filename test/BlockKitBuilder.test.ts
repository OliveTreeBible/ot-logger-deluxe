import { describe, expect, it } from "vitest";

import { normalizeFields } from "../src/internal/coerce.js";
import {
  buildSlackMessage,
  escapeMrkdwn,
  escapeInlineCode,
} from "../src/slack/BlockKitBuilder.js";

describe("BlockKitBuilder", () => {
  it("escapes &, <, > in mrkdwn", () => {
    expect(escapeMrkdwn('a & <b> "c"')).toBe("a &amp; &lt;b&gt; \"c\"");
  });

  it("replaces backticks in inline code spans", () => {
    expect(escapeInlineCode("a`b`c")).toBe("a\u02cbb\u02cbc");
  });

  it("produces JSON-serializable output for tricky content", () => {
    const msg = buildSlackMessage({
      level: "warn",
      title: "svc",
      message: 'multi\nline with "quotes" & emoji 🔥 and <angle> brackets',
      fields: normalizeFields({
        path: "C:\\Users\\foo",
        note: { value: 'backtick ` and "quotes"', code: true },
      }),
      hostname: "host-1",
      timestamp: new Date("2024-06-01T12:34:56.000Z"),
    });

    expect(() => JSON.stringify(msg)).not.toThrow();
    const roundtrip = JSON.parse(JSON.stringify(msg));
    expect(roundtrip.blocks[0].type).toBe("header");
    expect(roundtrip.text).toContain("WARNING");
  });

  it("includes a Block Kit header, message section, fields, and context", () => {
    const msg = buildSlackMessage({
      level: "error",
      title: "svc",
      message: "boom",
      fields: normalizeFields({ a: 1, b: 2 }),
      hostname: "host",
      timestamp: new Date(),
    });

    const types = msg.blocks.map((b) => b.type);
    expect(types[0]).toBe("header");
    expect(types).toContain("section");
    expect(types.at(-1)).toBe("context");
  });

  it("renders a mention block only when supplied", () => {
    const withMention = buildSlackMessage({
      level: "fatal",
      title: "svc",
      message: "down",
      fields: [],
      hostname: "host",
      timestamp: new Date(),
      mention: "@channel",
    });
    const withoutMention = buildSlackMessage({
      level: "fatal",
      title: "svc",
      message: "down",
      fields: [],
      hostname: "host",
      timestamp: new Date(),
    });

    const mentionBlocks = withMention.blocks.filter(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        typeof b.text === "object" &&
        b.text !== null &&
        "text" in b.text &&
        typeof (b.text as { text: unknown }).text === "string" &&
        ((b.text as { text: string }).text.includes("NOTIFY:"))
    );
    expect(mentionBlocks).toHaveLength(1);

    const plainMentionBlocks = withoutMention.blocks.filter(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        typeof b.text === "object" &&
        b.text !== null &&
        "text" in b.text &&
        typeof (b.text as { text: unknown }).text === "string" &&
        ((b.text as { text: string }).text.includes("NOTIFY:"))
    );
    expect(plainMentionBlocks).toHaveLength(0);
  });

  it("truncates oversized field text", () => {
    const huge = "x".repeat(10_000);
    const msg = buildSlackMessage({
      level: "info",
      title: "svc",
      message: "ok",
      fields: normalizeFields({ big: huge }),
      hostname: "host",
      timestamp: new Date(),
    });

    const fieldSection = msg.blocks.find(
      (b) => b.type === "section" && "fields" in b && Array.isArray(b.fields)
    ) as { fields: Array<{ text: string }> } | undefined;
    expect(fieldSection).toBeDefined();
    const rendered = fieldSection!.fields[0]!.text;
    expect(rendered.length).toBeLessThanOrEqual(3000);
    expect(rendered.endsWith("...")).toBe(true);
  });
});
