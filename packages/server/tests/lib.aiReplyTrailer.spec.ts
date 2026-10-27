import { AiClarificationSchema } from "@kinetica-bi/shared";
import { describe, expect, it } from "vitest";
import { parseReplyTrailer, toChoiceClarification } from "../src/lib/ai/replyTrailer";

describe("parseReplyTrailer", () => {
  it("TRL-1: strips a Follow-ups block", () => {
    expect(parseReplyTrailer("Added a bar chart.\n\nFollow-ups:\n- Show it by month\n- Add a pie chart of fares")).toEqual({
      text: "Added a bar chart.",
      followUps: ["Show it by month", "Add a pie chart of fares"],
      choices: [],
    });
  });
  it("TRL-2: no trailer leaves text unchanged", () => {
    expect(parseReplyTrailer("Done.  \n")).toEqual({ text: "Done.", followUps: [], choices: [] });
  });
  it("TRL-3: heading and bullet variants", () => {
    for (const h of ["Follow-ups:", "Follow up questions:", "FOLLOW-UPS:"])
      expect(parseReplyTrailer(`Hi\n${h}\n- a`).followUps).toEqual(["a"]);
    expect(parseReplyTrailer("Hi\nFollow-ups:\n* a\n• b\n1. c").followUps).toEqual(["a", "b", "c"]);
    expect(parseReplyTrailer("Hi\nFollow-ups:\n2) d").followUps).toEqual(["d"]);
  });
  it("TRL-4: caps count and length, drops empties and duplicates", () => {
    const long = "x".repeat(200);
    const r = parseReplyTrailer(`Hi\nFollow-ups:\n- a\n- a\n- ${long}\n- c\n- d`);
    expect(r.followUps).toEqual(["a", "x".repeat(120), "c"]);
  });
  it("TRL-5: choices plus follow-ups", () => {
    expect(
      parseReplyTrailer("Which total do you mean?\n\nChoices:\n- Total fare by vendor\n- Average fare by vendor\n\nFollow-ups:\n- Show trips by hour"),
    ).toEqual({
      text: "Which total do you mean?",
      choices: ["Total fare by vendor", "Average fare by vendor"],
      followUps: ["Show trips by hour"],
    });
  });
  it("TRL-6: a mid-text heading is not a trailer", () => {
    const t = "Intro\nFollow-ups:\n- a\nMore prose after.";
    expect(parseReplyTrailer(t)).toEqual({ text: t, followUps: [], choices: [] });
  });
  it("TRL-7: garbage never throws", () => {
    const big = "y".repeat(50000);
    expect(parseReplyTrailer(big).followUps).toEqual([]);
    expect(parseReplyTrailer("Hello\nFollow-ups:")).toEqual({ text: "Hello", followUps: [], choices: [] });
    expect(parseReplyTrailer("Hi\r\nFollow-ups:\r\n- a\r\n").followUps).toEqual(["a"]);
  });
  it("TRL-9: a trailing echo of a card question is dropped, so the trailer still parses", () => {
    const q = 'Remove the saved records "Recent Trip Records"?';
    const t = `I have started the process to remove the Records table.\n\nFollow-ups:\n- What else would you like to remove?\n- Add a summary instead\n\n${q}\n`;
    expect(parseReplyTrailer(t, [q])).toEqual({
      text: "I have started the process to remove the Records table.",
      followUps: ["What else would you like to remove?", "Add a summary instead"],
      choices: [],
    });
    expect(parseReplyTrailer(`Removing it.\n\n  ${q.toUpperCase()}  `, [q]).text).toBe("Removing it.");
    expect(parseReplyTrailer(`${q}\nThen the rest.`, [q]).text).toBe(`${q}\nThen the rest.`);
    expect(parseReplyTrailer(t).followUps).toEqual([]);
    expect(parseReplyTrailer(`${q}\n`, [q]).text).toBe(q); // the only text: kept, so the bubble is not empty
  });
  it("TRL-8: toChoiceClarification", () => {
    expect(toChoiceClarification("x?", ["only"])).toBeNull();
    const c = toChoiceClarification("Some text.\nWhich one?", ["Fare", "Tip"]);
    expect(c).toEqual({ kind: "choose_option", question: "Which one?", options: [{ id: "1", label: "Fare" }, { id: "2", label: "Tip" }] });
    expect(AiClarificationSchema.parse(c)).toBeTruthy();
    expect(toChoiceClarification("no question here", ["a", "b"])?.question).toBe("Which did you mean?");
  });
});
