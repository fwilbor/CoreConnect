import { describe, expect, it } from "vitest";
import { htmlToText, parseAddress, parseForwarded, stripQuoted } from "@/lib/intake/forwarded";

describe("parseAddress", () => {
  it("reads the common shapes", () => {
    expect(parseAddress("Ann Lee <Ann@Example.com>")).toEqual({ name: "Ann Lee", email: "ann@example.com" });
    expect(parseAddress('"Lee, Ann" <ann@example.com>')).toEqual({ name: "Ann Lee", email: "ann@example.com" });
    expect(parseAddress("*Ann Lee* <ann@example.com>")).toEqual({ name: "Ann Lee", email: "ann@example.com" });
    expect(parseAddress("Ann Lee [mailto:ann@example.com]")).toEqual({ name: "Ann Lee", email: "ann@example.com" });
    expect(parseAddress("ann@example.com")).toEqual({ name: null, email: "ann@example.com" });
  });
});

describe("parseForwarded", () => {
  it("parses a Gmail forward", () => {
    const text = [
      "Can you add this one?", "",
      "---------- Forwarded message ---------",
      "From: Ann Lee <ann@example.com>",
      "Date: Tue, Nov 4, 2026 at 9:12 AM",
      "Subject: Rottweiler puppies",
      "To: <breeder@gmail.com>", "",
      "Hi! Do you have any females coming this spring?",
      "You can call me at (312) 555-0142.", "",
      "Thanks, Ann",
    ].join("\n");
    expect(parseForwarded({ text, html: null, subject: "Fwd: Rottweiler puppies" })).toEqual({
      from: { name: "Ann Lee", email: "ann@example.com" },
      subject: "Rottweiler puppies",
      body: "Hi! Do you have any females coming this spring?\nYou can call me at (312) 555-0142.\n\nThanks, Ann",
      phone: "(312) 555-0142",
    });
  });

  it("parses an Apple Mail forward with quoted lines", () => {
    const text = [
      "Begin forwarded message:", "",
      "> From: Bob Stone <bob@example.org>",
      "> Subject: Waitlist",
      "> Date: November 3, 2026 at 8:00:00 PM CST",
      "> To: Kennel <kennel@icloud.com>",
      ">",
      "> Is the waitlist still open?",
    ].join("\n");
    const r = parseForwarded({ text, html: null, subject: "Fwd: Waitlist" });
    expect(r?.from).toEqual({ name: "Bob Stone", email: "bob@example.org" });
    expect(r?.body).toBe("Is the waitlist still open?");
  });

  it("parses an Outlook forward from HTML", () => {
    const html =
      "<div>FYI</div><hr><div><b>From:</b> Cara Diaz &lt;cara@example.net&gt;<br><b>Sent:</b> Monday, November 3, 2026 7:15 PM<br>" +
      "<b>To:</b> Kennel<br><b>Subject:</b> Question</div><div>&nbsp;</div><p>Are you near Tulsa?</p>";
    const r = parseForwarded({ text: null, html, subject: "FW: Question" });
    expect(r?.from.email).toBe("cara@example.net");
    expect(r?.subject).toBe("Question");
    expect(r?.body).toBe("Are you near Tulsa?");
  });

  it("looks past a no-reply sender for the buyer's address", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Facebook <notification@facebookmail.com>",
      "Date: Tue, Nov 4, 2026", "Subject: New message", "",
      "Dee Ray sent you a message: interested in a male. Email me at dee.ray@example.com",
    ].join("\n");
    expect(parseForwarded({ text, html: null, subject: null })?.from).toEqual({ name: null, email: "dee.ray@example.com" });
  });

  it("returns null when there's no forwarded header block", () => {
    expect(parseForwarded({ text: "Just a note, no forward here.\nFrom: me", html: null, subject: "hi" })).toBeNull();
  });
});

describe("helpers", () => {
  it("strips quoted history from replies", () => {
    expect(stripQuoted("Yes, Saturday works!\n\nOn Tue, Nov 4, 2026, Kennel wrote:\n> Can you visit?")).toBe("Yes, Saturday works!");
  });
  it("turns HTML into readable text", () => {
    expect(htmlToText("<p>Hi&nbsp;there</p><p>Line two<br>three</p><style>x{}</style>")).toBe("Hi there\nLine two\nthree");
  });
});
