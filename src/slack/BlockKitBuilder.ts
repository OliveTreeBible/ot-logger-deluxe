import type { ContextBlock, HeaderBlock, KnownBlock, SectionBlock } from "@slack/types";

import type { NormalizedField } from "../internal/coerce.js";
import { serializeError, stringify } from "../internal/coerce.js";
import type { SlackableLevel } from "../types.js";

/** Maximum character length of a Slack `mrkdwn` section text field. */
const SLACK_MRKDWN_MAX = 3000;

/** Render meta for a Slack message. */
export interface SlackMessage {
  /** Top-level text (fallback for notifications and screen readers). */
  text: string;
  /** Block Kit layout. */
  blocks: KnownBlock[];
}

export interface BuildArgs {
  level: SlackableLevel;
  title: string;
  message: string;
  fields: NormalizedField[];
  error?: unknown;
  code?: string;
  hostname: string;
  timestamp: Date;
  mention?: string;
}

interface LevelVisuals {
  icon: string;
  label: string;
}

const LEVEL_VISUALS: Record<SlackableLevel, LevelVisuals> = {
  info: { icon: ":information_source:", label: "Info" },
  warn: { icon: ":warning:", label: "Warning" },
  error: { icon: ":fire:", label: "Error" },
  fatal: { icon: ":skull_and_crossbones:", label: "Fatal" },
};

/**
 * Escape characters that carry special meaning in Slack `mrkdwn`.
 * Per Slack docs, only `&`, `<`, `>` need escaping.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Sanitize a string for use inside Slack inline code spans.
 * Backticks cannot appear inside a `code` span; substitute a visually similar
 * character to preserve readability.
 */
export function escapeInlineCode(text: string): string {
  return text.replaceAll("`", "\u02cb");
}

/** Truncate a string to `max` chars with an ellipsis suffix. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 3)) + "...";
}

function renderFieldValue(field: NormalizedField): string {
  if (field.code) {
    return "`" + truncate(escapeInlineCode(field.value), SLACK_MRKDWN_MAX - 50) + "`";
  }
  return truncate(escapeMrkdwn(field.value), SLACK_MRKDWN_MAX);
}

function renderFieldBlock(field: NormalizedField): { type: "mrkdwn"; text: string } {
  const label = `*${escapeMrkdwn(field.name)}:*`;
  const value = renderFieldValue(field);
  const combined = `${label} ${value}`;
  return {
    type: "mrkdwn",
    text: truncate(combined, SLACK_MRKDWN_MAX),
  };
}

/** Build a Slack message (text + Block Kit blocks) from a log event. */
export function buildSlackMessage(args: BuildArgs): SlackMessage {
  const visuals = LEVEL_VISUALS[args.level];
  const blocks: KnownBlock[] = [];

  const header: HeaderBlock = {
    type: "header",
    text: {
      type: "plain_text",
      text: truncate(`${visuals.label.toUpperCase()}: ${args.title}`, 150),
      emoji: true,
    },
  };
  blocks.push(header);

  const messageSection: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: truncate(`${visuals.icon} ${escapeMrkdwn(args.message)}`, SLACK_MRKDWN_MAX),
    },
  };
  blocks.push(messageSection);

  if (args.fields.length > 0) {
    const fieldBlocks = args.fields.slice(0, 10).map(renderFieldBlock);
    blocks.push({
      type: "section",
      fields: fieldBlocks,
    });

    if (args.fields.length > 10) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_+${args.fields.length - 10} additional field(s) omitted_`,
          },
        ],
      });
    }
  }

  if (args.code) {
    const codeText = truncate(
      "```" + args.code.replaceAll("```", "`\u200b`\u200b`") + "```",
      SLACK_MRKDWN_MAX
    );
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: codeText },
    });
  }

  if (args.error !== undefined) {
    const serialized = serializeError(args.error);
    const stack = typeof serialized.stack === "string" ? serialized.stack : stringify(serialized);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(
          `*Stack:*\n\`\`\`${stack.replaceAll("```", "`\u200b`\u200b`")}\`\`\``,
          SLACK_MRKDWN_MAX
        ),
      },
    });
  }

  if (args.mention) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:rotating_light: *NOTIFY:* ${args.mention}`,
      },
    });
  }

  const contextBlock: ContextBlock = {
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*host:* ${escapeMrkdwn(args.hostname)}` },
      { type: "mrkdwn", text: args.timestamp.toISOString() },
    ],
  };
  blocks.push(contextBlock);

  const text = `${visuals.label.toUpperCase()}: ${args.title} - ${args.message}`;
  return { text: truncate(text, SLACK_MRKDWN_MAX), blocks };
}
