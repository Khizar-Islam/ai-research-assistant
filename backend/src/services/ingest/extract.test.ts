import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanPdfPage, ExtractionError, extractText, joinPdfPages } from "./extract.ts";

describe("cleanPdfPage", () => {
  it("rejoins hard-wrapped lines into one paragraph", () => {
    const page = [
      "Retrieval-augmented generation pairs a language model with a",
      "search step, so answers can be grounded in documents that the",
      "model never saw during training.",
    ].join("\n");
    assert.equal(
      cleanPdfPage(page),
      "Retrieval-augmented generation pairs a language model with a search step, so answers can be grounded in documents that the model never saw during training.",
    );
  });

  it("undoes hyphenation when the joined word appears elsewhere in the document", () => {
    assert.equal(
      cleanPdfPage("Chunks keep enough surrounding infor-\nmation to stay useful, and that information is retrieved."),
      "Chunks keep enough surrounding information to stay useful, and that information is retrieved.",
    );
  });

  it("keeps a real hyphenated compound that wrapped at the end of a line", () => {
    // Regression: a real CV produced "softwaredevelopment" here.
    assert.equal(
      cleanPdfPage("Wrote documentation, following professional software-\ndevelopment workflows and deadlines."),
      "Wrote documentation, following professional software-development workflows and deadlines.",
    );
  });

  it("uses the vocabulary it is given (the whole document), not just this page", () => {
    const page = "Retrieved chunks carry infor-\nmation from the source documents into the prompt.";
    assert.match(cleanPdfPage(page), /infor-mation/); // no evidence on this page alone
    assert.match(cleanPdfPage(page, new Set(["information"])), / information /);
  });

  it("keeps a hyphen when the next line starts with a capital", () => {
    assert.equal(cleanPdfPage("a pre-\nTrained model"), "a pre- Trained model");
  });

  it("breaks paragraphs at blank lines and at short lines ending a sentence", () => {
    const page = [
      "The first paragraph runs across two full-width lines of text in",
      "the original layout and then ends here.",
      "The second paragraph starts on a new line after a short one and",
      "keeps going for a while longer.",
      "",
      "Third paragraph.",
    ].join("\n");
    assert.equal(
      cleanPdfPage(page),
      [
        "The first paragraph runs across two full-width lines of text in the original layout and then ends here.",
        "The second paragraph starts on a new line after a short one and keeps going for a while longer.",
        "Third paragraph.",
      ].join("\n\n"),
    );
  });

  it("keeps a short heading out of the paragraph below it", () => {
    const page = [
      "Background",
      "Vector search compares embeddings by the angle between them rather than",
      "by exact keyword matches, which is what makes it useful for questions.",
    ].join("\n");
    assert.equal(
      cleanPdfPage(page),
      "Background\n\nVector search compares embeddings by the angle between them rather than by exact keyword matches, which is what makes it useful for questions.",
    );
  });

  it("turns tabs and runs of spaces into single spaces", () => {
    assert.equal(cleanPdfPage("Name\tValue   here"), "Name Value here");
  });
});

describe("joinPdfPages", () => {
  it("continues a sentence that runs across a page break", () => {
    assert.equal(joinPdfPages(["It ends on the", "next page. New paragraph."]), "It ends on the next page. New paragraph.");
    assert.equal(
      joinPdfPages(["Page one mentions information and infor-", "mation again."]),
      "Page one mentions information and information again.",
    );
    assert.equal(joinPdfPages(["A cross-page well-", "known compound."]), "A cross-page well-known compound.");
  });

  it("starts a new paragraph when the page ended a sentence, and skips empty pages", () => {
    assert.equal(joinPdfPages(["First page ends here.", "", "Second page."]), "First page ends here.\n\nSecond page.");
  });
});

describe("extractText (text files)", () => {
  it("strips the BOM and normalizes line endings", async () => {
    const buffer = Buffer.from("﻿Line one\r\nLine two\r\n\r\n\r\n\r\nNext paragraph  \r\n");
    assert.equal(await extractText(buffer, "text"), "Line one\nLine two\n\nNext paragraph");
  });

  it("rejects invalid UTF-8", async () => {
    await assert.rejects(extractText(Buffer.from([0x66, 0x6f, 0xff, 0x6f]), "text"), ExtractionError);
  });

  it("rejects a file with no letters or digits", async () => {
    await assert.rejects(extractText(Buffer.from(" \n\n --- \n"), "text"), /contains no text/);
  });
});
