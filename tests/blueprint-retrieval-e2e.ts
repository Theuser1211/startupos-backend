import type { BlueprintResult } from "../src/types/ai.js";

declare const process: {
  env: Record<string, string | undefined>;
};

async function main() {
  console.log("=== Blueprint Retrieval E2E (serialization boundary) ===");

  let baseURL =
    process.env.BASE_URL ||
    `http://${process.env.HOST || "localhost"}:${process.env.PORT || "3000"}`;

  // Railway deployments are typically HTTPS-only
  if (baseURL.includes(".railway.app") && baseURL.startsWith("http://")) {
    baseURL = baseURL.replace("http://", "https://");
  }

  console.log("Using baseURL:", baseURL);

  const auth = async () => {
    const email = `e2e_${Date.now()}@test.com`;
    const password = "Password123!"; // must satisfy schema minLength>=8
    const name = `E2E User ${Date.now()}`;

    let registerRes: Response;
    try {
      registerRes = await fetch(`${baseURL}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
    } catch (e) {
      console.error("Fetch /auth/register failed:", e);
      throw e;
    }

    if (!registerRes.ok) {
      const text = await registerRes.text();
      throw new Error(`Register failed: ${registerRes.status} ${text}`);
    }

    const registerJson = await registerRes.json();
    const token = registerJson.token as string;

    // Prefer returned token; login endpoint is optional.
    return token;
  };

  const token = await auth();

  const createStartup = async () => {
    // NOTE: Adjust payload if your startup schema requires additional fields.
    const startupPayload = {
      name: `E2E Startup ${Date.now()}`,
      description: "E2E startup description",
      industry: "Tech",
    };

    const res = await fetch(`${baseURL}/startups/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(startupPayload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Startup create failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    const startupId = json.startupId || json.id || json.startup?.id;

    if (!startupId) {
      throw new Error(`Could not determine startupId from response: ${JSON.stringify(json)}`);
    }

    return startupId as string;
  };

  const startupId = await createStartup();

  // Trigger blueprint generation
  const generateRes = await fetch(`${baseURL}/blueprints/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      startupId,
      prompt: "A short prompt to generate a blueprint for this startup idea.",
    }),
  });

  if (!generateRes.ok) {
    const text = await generateRes.text();
    throw new Error(`Blueprint generate failed: ${generateRes.status} ${text}`);
  }

  const generateJson = await generateRes.json();
  const jobId = generateJson.jobId as string;

  console.log(`Job created: ${jobId}`);

  // Poll job until completed/failed, then GET blueprint by startupId
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let jobStatus: string | null = null;

  for (let i = 0; i < 60; i++) {
    await sleep(2000);

    const jobRes = await fetch(`${baseURL}/jobs/${jobId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });

    if (!jobRes.ok) {
      const text = await jobRes.text();
      throw new Error(`Job fetch failed: ${jobRes.status} ${text}`);
    }

    const jobJson = await jobRes.json();
    jobStatus = jobJson.job?.status;

    console.log(`Job status: ${jobStatus}`);

    if (jobStatus === "COMPLETED") break;
    if (jobStatus === "FAILED") {
      throw new Error(`Job failed: ${JSON.stringify(jobJson.job?.error)}`);
    }
  }

  if (jobStatus !== "COMPLETED") {
    throw new Error(`Job did not complete in time. Last status: ${jobStatus}`);
  }

  // The job result contains blueprintId
  const jobsResFinal = await fetch(`${baseURL}/jobs/${jobId}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  const jobsFinalJson = await jobsResFinal.json();
  const blueprintId = jobsFinalJson.job?.result?.blueprintId;

  if (!blueprintId) {
    throw new Error(
      `Could not determine blueprintId from job.result: ${JSON.stringify(jobsFinalJson.job?.result)}`,
    );
  }

  console.log(`Blueprint ID: ${blueprintId}`);

  const bpRes = await fetch(`${baseURL}/blueprints/${blueprintId}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });

  if (!bpRes.ok) {
    const text = await bpRes.text();
    throw new Error(`GET blueprint failed: ${bpRes.status} ${text}`);
  }

  const bpJson = await bpRes.json();
  const blueprint = bpJson.blueprint;

  console.log(
    "API blueprint payload content keys:",
    blueprint?.content ? Object.keys(blueprint.content) : "NO_CONTENT",
  );

  // Evidence: compare to non-empty expectation
  const content = blueprint?.content as Partial<BlueprintResult> | undefined;

  if (!content) throw new Error("API returned blueprint.content as undefined/null");

  const keys = Object.keys(content as object);
  if (keys.length === 0) {
    throw new Error(`BUG REPRO: API returned empty content object for blueprintId=${blueprintId}`);
  }

  console.log("✅ Blueprint retrieval serialization OK. content keys:", keys);
}

main().catch((err) => {
  console.error("❌ Blueprint retrieval E2E failed:", err instanceof Error ? err.message : err);
