import { describe, expect, it } from "vitest";

import { checkConfiguration, checkLiveness, checkRollback, checkWebhookSecurity, checkWorker } from "./http-checks";
import type { GateConfigReport, GateContext } from "./types";

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** A stand-in for the network: routes by method and path, and records every request. */
function network(routes: Record<string, Handler>) {
  const requests: Array<{ method: string; url: URL; headers: Record<string, string>; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    requests.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    const handler = routes[`${method} ${url.host}${url.pathname}`] ?? routes[`${method} ${url.pathname}`];
    if (!handler) return new Response("not found", { status: 404 });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function context(overrides: Partial<GateContext> & { fetchImpl: typeof fetch }): GateContext {
  return {
    baseUrl: "https://app.example.test",
    expectedEnvironment: "staging",
    cronSecret: "the-cron-secret",
    readSnapshot: async () => {
      throw new Error("not used here");
    },
    repoMigrationFiles: [],
    verifyTokens: {},
    ...overrides,
  };
}

describe("checkLiveness (G1)", () => {
  const healthy = { "GET /api/health": () => json({ status: "ok", build: "abc1234" }), "GET /api/health/ready": () => json({ status: "ready" }) };

  it("passes when the app is up, ready and the expected commit is live", async () => {
    const { fetchImpl } = network(healthy);
    const result = await checkLiveness(context({ fetchImpl, expectedCommit: "abc1234def5678" }));
    expect(result.status).toBe("PASS");
  });

  it("is pending, not passed, when it is up but the build was not compared", async () => {
    const { fetchImpl } = network(healthy);
    const result = await checkLiveness(context({ fetchImpl }));
    expect(result.status).toBe("PENDING");
    expect(result.detail).toMatch(/GATE_EXPECTED_COMMIT/);
  });

  it("fails on the wrong build", async () => {
    const { fetchImpl } = network(healthy);
    const result = await checkLiveness(context({ fetchImpl, expectedCommit: "fffffff" }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.[0]).toMatch(/live build is abc1234, expected fffffff/);
  });

  it("fails when the database is not ready", async () => {
    const { fetchImpl } = network({ ...healthy, "GET /api/health/ready": () => json({ status: "not_ready" }, 503) });
    const result = await checkLiveness(context({ fetchImpl, expectedCommit: "abc1234" }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.[0]).toMatch(/ready answered 503/);
  });

  it("fails, rather than throwing, when the app cannot be reached", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await checkLiveness(context({ fetchImpl }));
    expect(result.status).toBe("FAIL");
    expect(result.detail).toMatch(/could not be reached/);
  });
});

function configReport(environment: GateConfigReport["environment"], secretFingerprint = "aaaaaaaa"): GateConfigReport {
  return {
    environment,
    ready: true,
    problems: [],
    forbiddenPresent: [],
    variables: [{ name: "CRON_SECRET", kind: "secret", requirement: "always", present: true, fingerprint: secretFingerprint }],
  };
}

describe("checkConfiguration (G6)", () => {
  it("sends the bearer secret and judges the report", async () => {
    const { fetchImpl, requests } = network({ "GET /api/health/config": () => json(configReport("staging")) });
    const result = await checkConfiguration(context({ fetchImpl }));
    expect(result.status).toBe("PASS");
    expect(requests[0].headers.Authorization).toBe("Bearer the-cron-secret");
  });

  it("compares with the reference environment and fails on a shared secret", async () => {
    const { fetchImpl } = network({ "GET app.example.test/api/health/config": () => json(configReport("production")), "GET ref.example.test/api/health/config": () => json(configReport("staging")) });
    const result = await checkConfiguration(context({ fetchImpl, expectedEnvironment: "production", reference: { baseUrl: "https://ref.example.test", cronSecret: "ref-secret" } }));
    expect(result.status).toBe("FAIL");
    expect(result.items).toContain("CRON_SECRET has the same value as the reference environment");
  });

  it("fails when the endpoint refuses the secret", async () => {
    const { fetchImpl } = network({ "GET /api/health/config": () => json({ error: "Unauthorized" }, 401) });
    const result = await checkConfiguration(context({ fetchImpl }));
    expect(result.status).toBe("FAIL");
    expect(result.detail).toMatch(/answered 401/);
  });

  it("fails without trying when no secret was supplied", async () => {
    const { fetchImpl, requests } = network({});
    const result = await checkConfiguration(context({ fetchImpl, cronSecret: undefined }));
    expect(result.status).toBe("FAIL");
    expect(requests).toHaveLength(0);
  });
});

describe("checkWorker (G7)", () => {
  it("is pending when no worker address was given", async () => {
    const { fetchImpl } = network({});
    expect((await checkWorker(context({ fetchImpl }))).status).toBe("PENDING");
  });

  it("passes when both worker probes answer 200, and fails when one does not", async () => {
    const ok = network({ "GET /healthz": () => json({}), "GET /readyz": () => json({}) });
    expect((await checkWorker(context({ fetchImpl: ok.fetchImpl, workerUrl: "https://worker.example.test" }))).status).toBe("PASS");
    const stuck = network({ "GET /healthz": () => json({}, 503), "GET /readyz": () => json({}) });
    const result = await checkWorker(context({ fetchImpl: stuck.fetchImpl, workerUrl: "https://worker.example.test" }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.[0]).toMatch(/healthz answered 503/);
  });
});

/** A deployment that behaves: refuses forged and unsigned deliveries, refuses a wrong token, echoes the challenge for the right one. */
function wellBehavedWebhooks(rightToken = "right-token") {
  const routes: Record<string, Handler> = {};
  for (const path of ["/api/webhooks/whatsapp", "/api/webhooks/messenger", "/api/webhooks/instagram"]) {
    routes[`POST ${path}`] = () => new Response("Unauthorized", { status: 401 });
    routes[`GET ${path}`] = (url) =>
      url.searchParams.get("hub.verify_token") === rightToken ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  return routes;
}

describe("checkWebhookSecurity (G8)", () => {
  it("passes when every channel refuses forged and unsigned events and a wrong token, and answers the real handshake", async () => {
    const { fetchImpl } = network(wellBehavedWebhooks());
    const result = await checkWebhookSecurity(context({ fetchImpl, verifyTokens: { WHATSAPP: "right-token", MESSENGER: "right-token", INSTAGRAM: "right-token" } }));
    expect(result.status).toBe("PASS");
  });

  it("is pending, not passed, when the real tokens were not supplied", async () => {
    const { fetchImpl } = network(wellBehavedWebhooks());
    const result = await checkWebhookSecurity(context({ fetchImpl }));
    expect(result.status).toBe("PENDING");
    expect(result.items?.length).toBe(3);
  });

  it("fails when a channel accepts a forged event, as a deployment with no app secret does (it answers 200 'misconfigured')", async () => {
    const routes = wellBehavedWebhooks();
    routes["POST /api/webhooks/messenger"] = () => json({ status: "misconfigured" }, 200);
    const { fetchImpl } = network(routes);
    const result = await checkWebhookSecurity(context({ fetchImpl }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.join(" ")).toMatch(/Messenger: a forged signature was answered 200, expected 401/);
  });

  it("fails when a wrong verify token is accepted", async () => {
    const routes = wellBehavedWebhooks();
    routes["GET /api/webhooks/instagram"] = (url) => new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    const { fetchImpl } = network(routes);
    const result = await checkWebhookSecurity(context({ fetchImpl }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.join(" ")).toMatch(/Instagram: .*a wrong verify token was answered 200, expected 403/);
  });

  it("fails when the real token does not produce the challenge", async () => {
    const { fetchImpl } = network(wellBehavedWebhooks("a-different-token"));
    const result = await checkWebhookSecurity(context({ fetchImpl, verifyTokens: { WHATSAPP: "right-token" } }));
    expect(result.status).toBe("FAIL");
    expect(result.items?.join(" ")).toMatch(/Whatsapp: .*handshake with the right token/);
  });

  it("addresses only simulator accounts and never carries a signature that could be valid, so it cannot reach a real agency", async () => {
    const { fetchImpl, requests } = network(wellBehavedWebhooks());
    await checkWebhookSecurity(context({ fetchImpl }));
    const posts = requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(6);
    for (const post of posts) {
      const payload = JSON.parse(post.body) as { entry?: Array<{ id?: string; changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }> };
      const ids = [payload.entry?.[0]?.id, payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id].filter(Boolean) as string[];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toMatch(/^sim[-_.]/i);
      const signature = post.headers["X-Hub-Signature-256"];
      expect(signature === undefined || signature === `sha256=${"0".repeat(64)}`).toBe(true);
    }
  });
});

describe("checkRollback (G13)", () => {
  const vercel = { token: "t", projectId: "prj_1", teamId: "team_1" };

  it("is pending when no Vercel token was supplied", async () => {
    const { fetchImpl } = network({});
    expect((await checkRollback(context({ fetchImpl }))).status).toBe("PENDING");
  });

  it("passes with two or more ready production deployments, asking only for production and ready ones", async () => {
    const { fetchImpl, requests } = network({ "GET /v6/deployments": () => json({ deployments: [{}, {}, {}] }) });
    const result = await checkRollback(context({ fetchImpl, vercel }));
    expect(result.status).toBe("PASS");
    const url = requests[0].url;
    expect(url.searchParams.get("target")).toBe("production");
    expect(url.searchParams.get("state")).toBe("READY");
    expect(url.searchParams.get("teamId")).toBe("team_1");
    expect(requests[0].headers.Authorization).toBe("Bearer t");
  });

  it("fails with only one ready deployment, because there is nothing earlier to restore", async () => {
    const { fetchImpl } = network({ "GET /v6/deployments": () => json({ deployments: [{}] }) });
    expect((await checkRollback(context({ fetchImpl, vercel }))).status).toBe("FAIL");
  });

  it("fails when Vercel refuses the token", async () => {
    const { fetchImpl } = network({ "GET /v6/deployments": () => json({}, 403) });
    expect((await checkRollback(context({ fetchImpl, vercel }))).status).toBe("FAIL");
  });
});
