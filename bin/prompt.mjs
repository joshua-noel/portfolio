// The password prompt of bin/user.mjs, in a module of its own so a test can
// give it streams instead of a terminal.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

/**
 * Asks once and reads the answer without echoing it. Readline gets its own
 * output that swallows everything, so what the user types is never written
 * anywhere; the prompt and the newline go to `output` directly. (An earlier
 * version replaced `write` on the real stderr to hide the echo, which also
 * hid every message the process printed afterwards.)
 */
/**
 * @typedef {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream }} Streams
 */

/**
 * @param {string} prompt
 * @param {Streams} streams
 * @returns {Promise<string>}
 */
export async function askHidden(prompt, { input, output }) {
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input, output: muted, terminal: true });
  output.write(prompt);
  try {
    const answered = Promise.withResolvers();
    // End of input or Ctrl-C closes readline without an answer.
    rl.once("close", () => answered.reject(new Error("no password was entered")));
    rl.question("", answered.resolve);
    return await answered.promise;
  } finally {
    rl.close();
    output.write("\n");
  }
}

/**
 * The password for a new or changed account. From a terminal it is asked for
 * twice, hidden; from a pipe it is the first line of standard input.
 * Throws an Error whose message is meant for the user.
 */
/**
 * @param {{ confirm: boolean, input?: NodeJS.ReadableStream & { isTTY?: boolean },
 *   output?: NodeJS.WritableStream, interactive?: boolean }} options
 * @returns {Promise<string>}
 */
export async function readPassword({
  confirm,
  input = process.stdin,
  output = process.stderr,
  interactive = Boolean(input.isTTY),
}) {
  if (!interactive) {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0];
  }
  const first = await askHidden("Password: ", { input, output });
  if (confirm && (await askHidden("Again: ", { input, output })) !== first) {
    throw new Error("the two passwords differ");
  }
  return first;
}
