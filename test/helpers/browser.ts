import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A headless Chromium, driven over the DevTools protocol with nothing but
 * Node's own WebSocket: no test dependency. It is for the checks only a
 * browser can make (what the Content-Security-Policy blocks, what a hover
 * does, what shows with scripts off). `findBrowser` returns nothing on a
 * machine that has none, and the tests that need one say so and stop; set
 * PORTFOLIO_TEST_BROWSER to a Chrome, Chromium or Edge to choose one.
 */

const CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
  ],
};

export function findBrowser(): string | undefined {
  const chosen = process.env.PORTFOLIO_TEST_BROWSER;
  if (chosen) return existsSync(chosen) ? chosen : undefined;
  return (CANDIDATES[process.platform] ?? []).find((path) => existsSync(path));
}

type Params = Record<string, unknown>;
type Handler = (method: string, params: Params, sessionId?: string) => void;

class Cdp {
  private next = 0;
  private waiting = new Map<
    number,
    { ok: (v: Params) => void; fail: (e: Error) => void }
  >();
  handlers = new Set<Handler>();
  private ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Params;
        error?: { message: string };
        method?: string;
        params?: Params;
        sessionId?: string;
      };
      if (message.id !== undefined) {
        const entry = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) entry?.fail(new Error(message.error.message));
        else entry?.ok(message.result ?? {});
      } else if (message.method) {
        for (const handler of this.handlers)
          handler(message.method, message.params ?? {}, message.sessionId);
      }
    });
  }
  send(method: string, params: Params = {}, sessionId?: string): Promise<Params> {
    const id = ++this.next;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Tab: { code: "Tab", vk: 9 },
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Escape: { code: "Escape", vk: 27 },
  " ": { code: "Space", vk: 32, text: " " },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
};

export interface PageOptions {
  /** Added to every request, in place of any the page sends: how a test says it is behind the proxy. */
  headers?: Record<string, string>;
  width?: number;
  height?: number;
  /** Scripts on (the default) or off. */
  javaScript?: boolean;
  reducedMotion?: boolean;
  colorScheme?: "light" | "dark";
}

export class Page {
  /** Uncaught errors, errors written to the console, and the browser's own error messages (a blocked or failed load). */
  errors: string[] = [];

  private cdp: Cdp;
  private session: string;
  private targetId: string;

  constructor(cdp: Cdp, session: string, targetId: string) {
    this.cdp = cdp;
    this.session = session;
    this.targetId = targetId;
  }

  private send(method: string, params: Params = {}): Promise<Params> {
    return this.cdp.send(method, params, this.session);
  }

  async init(options: PageOptions): Promise<void> {
    const headers = options.headers ?? {};
    this.cdp.handlers.add((method, params, session) => {
      if (session !== this.session) return;
      if (method === "Fetch.requestPaused") {
        const request = params.request as { headers: Record<string, string> };
        void this.send("Fetch.continueRequest", {
          requestId: params.requestId,
          headers: Object.entries({ ...request.headers, ...headers }).map(
            ([name, value]) => ({
              name,
              value,
            }),
          ),
        });
      } else if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as {
          text: string;
          exception?: { description?: string };
        };
        this.errors.push(`exception: ${details.exception?.description ?? details.text}`);
      } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        const args = params.args as { value?: unknown; description?: string }[];
        this.errors.push(
          `console.error: ${args.map((a) => a.value ?? a.description).join(" ")}`,
        );
      } else if (method === "Log.entryAdded") {
        const entry = params.entry as { level: string; text: string; url?: string };
        if (entry.level === "error" && !/favicon/.test(entry.url ?? entry.text))
          this.errors.push(`log: ${entry.text} ${entry.url ?? ""}`);
      }
    });
    await Promise.all([
      this.send("Page.enable"),
      this.send("Runtime.enable"),
      this.send("Log.enable"),
    ]);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: options.width ?? 1440,
      height: options.height ?? 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (options.javaScript === false) {
      await this.send("Emulation.setScriptExecutionDisabled", { value: true });
    }
    const features = [
      {
        name: "prefers-reduced-motion",
        value: options.reducedMotion ? "reduce" : "no-preference",
      },
      { name: "prefers-color-scheme", value: options.colorScheme ?? "dark" },
    ];
    await this.send("Emulation.setEmulatedMedia", { features });
    // Reports every violation, whichever directive and whoever caused it.
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__violations = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          window.__violations.push(e.violatedDirective + " " + e.blockedURI));`,
    });
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  }

  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const handler: Handler = (method, _params, session) => {
        if (method === "Page.loadEventFired" && session === this.session) {
          this.cdp.handlers.delete(handler);
          resolve();
        }
      };
      this.cdp.handlers.add(handler);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    };
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  /** Polls `expression` until it is truthy. */
  async waitFor(expression: string, what: string, timeout = 8000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /** The Content-Security-Policy violations the page has reported, as the browser saw them. */
  reportedViolations(): Promise<string[]> {
    return this.evaluate<string[]>("window.__violations ?? []");
  }

  /**
   * Waits until the page holds still: no transition or animation that will end
   * is running, and the page has not scrolled for a moment. A pointer aimed at
   * something that is still sliding or scrolling lands where it was, not where it is.
   */
  async settle(timeout = 8000): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastY = Number.NaN;
    let still = 0;
    while (Date.now() < deadline) {
      const state = await this.evaluate<{ moving: number; y: number }>(`(() => ({
        moving: document.getAnimations().filter((a) => a.playState === "running" &&
          a.effect?.getComputedTiming().iterations !== Infinity).length,
        y: scrollY,
      }))()`);
      still = state.moving === 0 && state.y === lastY ? still + 1 : 0;
      if (still >= 3) return;
      lastY = state.y;
      await sleep(50);
    }
    throw new Error("the page did not hold still");
  }

  private async centre(selector: string): Promise<{ x: number; y: number }> {
    await this.settle();
    const box = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`no element matches ${selector}`);
    return box;
  }

  async hover(selector: string): Promise<void> {
    const { x, y } = await this.centre(selector);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  async click(selector: string): Promise<void> {
    const { x, y } = await this.centre(selector);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  /** Moves the pointer somewhere that is no book. */
  async moveAway(): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  }

  async press(key: string): Promise<void> {
    const k = KEYS[key];
    if (!k) throw new Error(`unknown key ${key}`);
    const base = {
      key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    };
    await this.send("Input.dispatchKeyEvent", {
      type: k.text ? "keyDown" : "rawKeyDown",
      ...base,
      text: k.text,
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async screenshot(path: string): Promise<void> {
    const shot = (await this.send("Page.captureScreenshot", { format: "png" })) as {
      data: string;
    };
    writeFileSync(path, Buffer.from(shot.data, "base64"));
  }

  async close(): Promise<void> {
    await this.cdp
      .send("Target.closeTarget", { targetId: this.targetId })
      .catch(() => {});
  }
}

export class Browser {
  private child: ChildProcess;
  private cdp: Cdp;
  private profile: string;

  private constructor(child: ChildProcess, cdp: Cdp, profile: string) {
    this.child = child;
    this.cdp = cdp;
    this.profile = profile;
  }

  /**
   * Starts the browser. `map` sends a host name to a local port, so a page
   * at http://learn.test/ reaches the test server and sends `Host: learn.test`.
   */
  static async launch(
    executable: string,
    map: { host: string; port: number },
  ): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), "portfolio-browser-"));
    const child = spawn(
      executable,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        `--host-resolver-rules=MAP ${map.host} 127.0.0.1:${map.port}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const url = await new Promise<string>((resolve, reject) => {
      let log = "";
      const timer = setTimeout(
        () => reject(new Error(`browser did not start:\n${log}`)),
        20_000,
      );
      child.stderr!.on("data", (chunk) => {
        log += String(chunk);
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]!);
        }
      });
      child.on("exit", () => reject(new Error(`browser exited early:\n${log}`)));
    });
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () =>
        reject(new Error("could not connect to the browser")),
      );
    });
    return new Browser(child, new Cdp(ws), profile);
  }

  async newPage(options: PageOptions = {}): Promise<Page> {
    const { targetId } = (await this.cdp.send("Target.createTarget", {
      url: "about:blank",
    })) as { targetId: string };
    const { sessionId } = (await this.cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as {
      sessionId: string;
    };
    const page = new Page(this.cdp, sessionId, targetId);
    await page.init(options);
    return page;
  }

  async close(): Promise<void> {
    const exited = new Promise<void>((resolve) => this.child.on("exit", () => resolve()));
    this.child.kill();
    await Promise.race([exited, sleep(5000)]);
    // The browser may still hold files for a moment on Windows.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(this.profile, { recursive: true, force: true });
        return;
      } catch {
        await sleep(300);
      }
    }
  }
}
