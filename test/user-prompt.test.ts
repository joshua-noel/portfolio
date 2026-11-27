import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { askHidden, readPassword } from "../bin/prompt.mjs";
/** A terminal stand-in: what is typed goes into `input`, what is shown is collected. */
function terminal() {
  const input = new PassThrough();
  let shown = "";
  const waiting: { text: string; resolve: () => void }[] = [];
  const output = new Writable({
    write(chunk, _encoding, done) {
      shown += String(chunk);
      for (const waiter of waiting.filter((w) => shown.includes(w.text))) waiter.resolve();
      done();
    },
  });
  // Resolves when the text has been shown (the test runner's own timeout is the bound).
  const until = (text: string): Promise<void> => {
    if (shown.includes(text)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.push({ text, resolve });
    return promise;
  };
  return { input, output, until, shown: () => shown };
}

test("the prompt shows the prompt, never the password, and does not touch standard error", async () => {
  const stderrWrite = process.stderr.write;
  const t = terminal();
  const answer = askHidden("Password: ", { input: t.input, output: t.output });
  await t.until("Password: ");
  t.input.write("hunter2-hunter2\r");
  assert.equal(await answer, "hunter2-hunter2");
  assert.ok(!t.shown().includes("hunter2"), "the typed password was echoed");
  // The bug was `process.stderr.write = () => {}` for the rest of the process.
  assert.equal(process.stderr.write, stderrWrite);
});

test("asked twice, the second prompt shows too, and matching answers are returned", async () => {
  const t = terminal();
  const result = readPassword({
    confirm: true,
    input: t.input,
    output: t.output,
    interactive: true,
  });
  await t.until("Password: ");
  t.input.write("correct horse 1\r");
  await t.until("Again: ");
  t.input.write("correct horse 1\r");
  assert.equal(await result, "correct horse 1");
  assert.ok(!t.shown().includes("correct horse"));
});

test("two different answers are an error with a message, not silence", async () => {
  const t = terminal();
  const result = readPassword({
    confirm: true,
    input: t.input,
    output: t.output,
    interactive: true,
  });
  await t.until("Password: ");
  t.input.write("correct horse 1\r");
  await t.until("Again: ");
  t.input.write("something else\r");
  await assert.rejects(result, /the two passwords differ/);
});

test("end of input before an answer is an error", async () => {
  const t = terminal();
  const result = readPassword({
    confirm: false,
    input: t.input,
    output: t.output,
    interactive: true,
  });
  await t.until("Password: ");
  t.input.end();
  await assert.rejects(result, /no password was entered/);
});

test("piped input is the first line, with no prompt", async () => {
  const input = new PassThrough();
  const t = terminal();
  const result = readPassword({
    confirm: true,
    input,
    output: t.output,
    interactive: false,
  });
  input.end("piped password\nignored\n");
  assert.equal(await result, "piped password");
  assert.equal(t.shown(), "");
});
