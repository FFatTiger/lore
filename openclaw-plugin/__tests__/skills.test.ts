import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillsSession,
  registerSkillTools,
  resolveLoreHome,
} from "../skills";
import { registerHooks } from "../hooks";
import { registerTools } from "../tools";
import {
  computeManifestHash,
  materializeSkillWorkCopy,
  sha256Text,
} from "../vendor/skill-workcopy/index.mjs";

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lore-openclaw-skills-"));
}

function rmTempHome(dir: string) {
  const walk = (current: string) => {
    try {
      const st = fs.lstatSync(current);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        try { fs.chmodSync(current, 0o755); } catch { /* ignore */ }
        for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) {
        try { fs.chmodSync(current, 0o644); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };
  walk(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function skillDetail(overrides: Record<string, unknown> = {}) {
  const content = String(overrides.content ?? "# Demo Skill\n\nDo the thing.\n");
  const files = (overrides.files as any[]) || [
    {
      path: "SKILL.md",
      content,
      sha256: sha256Text(content),
      size: Buffer.byteLength(content, "utf-8"),
      media_type: "text/markdown",
    },
  ];
  const manifest_hash = typeof overrides.manifest_hash === "string"
    ? overrides.manifest_hash
    : computeManifestHash(
      files.map((f) => {
        const buf = f.content_base64
          ? Buffer.from(f.content_base64, "base64")
          : Buffer.from(String(f.content || ""), "utf-8");
        return {
          path: f.path,
          sha256: f.sha256 || crypto.createHash("sha256").update(buf).digest("hex"),
          size: buf.length,
        };
      }),
    );
  const { content: _c, files: _f, manifest_hash: _m, ...rest } = overrides;
  return {
    id: "skill-1",
    project_id: "proj-1",
    name: "demo-skill",
    description: "A demo skill",
    enabled: true,
    version: 1,
    ...rest,
    manifest_hash,
    files,
  };
}

function makeMockApi() {
  const tools: Record<string, any> = {};
  return {
    tools,
    registerTool(def: any) {
      tools[def.name] = def;
    },
  };
}

describe("skills discovery helpers", () => {
  it("resolves LORE_HOME", () => {
    const dir = makeTempHome();
    expect(resolveLoreHome({ LORE_HOME: dir } as any)).toBe(path.resolve(dir));
    rmTempHome(dir);
  });
});

describe("skills tools", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers skill tools without promptSnippet/guidance and without artifact tool", () => {
    const api = makeMockApi();
    registerTools(api as any, {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      defaultDomain: "core",
      recallEnabled: true,
      skillsEnabled: true,
    });
    const skillTools = [
      "lore_skill_list",
      "lore_skill_search",
      "lore_skill_create",
      "lore_skill_update",
      "lore_skill_delete",
      "lore_skill_import",
    ];
    for (const name of skillTools) {
      expect(api.tools[name]).toBeDefined();
      expect(api.tools[name].promptSnippet).toBeUndefined();
      expect(api.tools[name].promptGuidelines).toBeUndefined();
      expect(api.tools[name].guidance).toBeUndefined();
    }
    expect(api.tools.lore_skill_artifact_create).toBeUndefined();
    // The registered set is exactly the management tools plus memory tools.
    expect(Object.keys(api.tools).sort()).toEqual([
      "lore_boot",
      "lore_create_node",
      "lore_delete_node",
      "lore_get_node",
      "lore_list_domains",
      "lore_move_node",
      "lore_search",
      "lore_skill_create",
      "lore_skill_delete",
      "lore_skill_import",
      "lore_skill_list",
      "lore_skill_search",
      "lore_skill_update",
      "lore_status",
      "lore_update_node",
    ]);
    expect(Object.keys(api.tools)).toHaveLength(15);
  });

  it("uses the shared lore_skill_import description and notes the next-session sync on mutations", () => {
    const api = makeMockApi();
    registerTools(api as any, {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      defaultDomain: "core",
      recallEnabled: true,
      skillsEnabled: true,
    });
    expect(api.tools.lore_skill_import.description).toBe(
      "Import skills from a public GitHub repository (owner/repo, a GitHub URL, a tree URL to one skill, or a pasted npx skills add command) into Lore. "
      + "Run with dry_run first to see what will be imported. Never overwrites existing skills.",
    );
    for (const name of ["lore_skill_create", "lore_skill_update", "lore_skill_delete"]) {
      expect(api.tools[name].description).toContain(
        "Changes sync to the local skills directory when the next session starts.",
      );
    }
  });

  it("create/update/delete send expected bodies and do not auto-reconcile", async () => {
    const loreHome = makeTempHome();
    const projectId = "proj-tools";
    const api = makeMockApi();
    const pluginCfg = {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      loreHome,
      defaultDomain: "core",
    };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(api as any, pluginCfg, session);

    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
      const u = String(url);
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });

      if (method === "POST" && u.includes("/api/skills")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ id: "skill-tool", name: "tool-skill", version: 1, project_id: projectId }),
        };
      }
      if (method === "PATCH" && u.includes("/api/skills/skill-tool")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ id: "skill-tool", name: "tool-skill", version: 2, project_id: projectId }),
        };
      }
      if (method === "DELETE" && u.includes("/api/skills/skill-tool")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ ok: true, id: "skill-tool" }),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => `missing ${u}` };
    }));

    const createBody = {
      name: "tool-skill",
      enabled: true,
      files: [{ path: "SKILL.md", content: "# Tool\n" }],
    };
    const created = await api.tools.lore_skill_create.execute("t1", createBody);
    expect(created.details.ok).toBe(true);
    expect(created.content[0].text).toContain("skill_id: skill-tool");
    expect(created.content[0].text).toContain("version: 1");
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject(createBody);

    const updated = await api.tools.lore_skill_update.execute("t2", {
      skill_id: "skill-tool",
      expected_version: 1,
      enabled: false,
      upsert_files: [{ path: "SKILL.md", content: "# Tool v2\n" }],
      delete_paths: ["old.md"],
    });
    expect(updated.details.ok).toBe(true);
    expect(updated.content[0].text).toContain("skill_id: skill-tool");
    expect(updated.content[0].text).toContain("version: 2");
    const updateCall = calls.find((c) => c.method === "PATCH");
    expect(updateCall?.body).toMatchObject({
      expected_version: 1,
      enabled: false,
      upsert_files: [{ path: "SKILL.md", content: "# Tool v2\n" }],
      delete_paths: ["old.md"],
    });

    const deleted = await api.tools.lore_skill_delete.execute("t3", { skill_id: "skill-tool" });
    expect(deleted.details.ok).toBe(true);
    expect(calls.filter((c) => c.method === "GET" && c.url.includes("/api/skills?"))).toHaveLength(0);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it("expected_version is required positive integer on update", async () => {
    const loreHome = makeTempHome();
    const api = makeMockApi();
    const pluginCfg = { baseUrl: "http://host", apiToken: "", timeoutMs: 1000, loreHome };
    registerSkillTools(api as any, pluginCfg, createSkillsSession(pluginCfg));
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("should not call server without expected_version");
    }));

    const missing = await api.tools.lore_skill_update.execute("t", {
      skill_id: "skill-tool",
      upsert_files: [{ path: "SKILL.md", content: "# x\n" }],
    });
    expect(missing.details.ok).toBe(false);
    expect(missing.details.error).toMatch(/expected_version/);

    const zero = await api.tools.lore_skill_update.execute("t", {
      skill_id: "skill-tool",
      expected_version: 0,
    });
    expect(zero.details.ok).toBe(false);
    expect(zero.details.error).toMatch(/positive integer/);

    const nonInt = await api.tools.lore_skill_update.execute("t", {
      skill_id: "skill-tool",
      expected_version: 1.5,
    });
    expect(nonInt.details.ok).toBe(false);
    expect(nonInt.details.error).toMatch(/expected_version|positive integer/);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it("lore_skill_import posts to the import endpoint and summarizes candidates and results", async () => {
    const loreHome = makeTempHome();
    const api = makeMockApi();
    const pluginCfg = {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      loreHome,
      defaultDomain: "core",
    };
    registerSkillTools(api as any, pluginCfg, createSkillsSession(pluginCfg));

    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
      const u = String(url);
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      if (method === "POST" && u.includes("/api/skills/import")) {
        if (body?.dry_run === true) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({
              repo: "vercel-labs/agent-skills",
              ref: "main",
              commit: "c".repeat(40),
              path: "",
              candidates: [
                { name: "frontend-design", description: "Design", path: "skills/frontend-design", file_count: 3, total_size: 4211, exists: false, selected: true, error: null },
                { name: "legacy", description: "Old", path: "skills/legacy", file_count: 2, total_size: 900, exists: true, selected: true, error: null },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            repo: "vercel-labs/agent-skills",
            ref: "main",
            commit: "c".repeat(40),
            path: "",
            candidates: [],
            results: [
              { name: "frontend-design", status: "created", skill_id: "skill-import-1", error: null },
              { name: "legacy", status: "exists", skill_id: "skill-old", error: null },
              { name: "broken", status: "failed", skill_id: null, error: "bad SKILL.md frontmatter" },
            ],
          }),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => `missing ${u}` };
    }));

    const dry = await api.tools.lore_skill_import.execute("t1", {
      source: "npx skills add vercel-labs/agent-skills --skill frontend-design",
      dry_run: true,
    });
    expect(dry.details.ok).toBe(true);
    expect(dry.content[0].text).toContain("Dry run from vercel-labs/agent-skills@main: 2 candidate skill(s)");
    expect(dry.content[0].text).toContain("- frontend-design — will import — skills/frontend-design — 3 files — 4211 bytes");
    expect(dry.content[0].text).toContain("- legacy — already exists — skills/legacy");
    expect(dry.content[0].text).toContain('\"candidates\"');

    const run = await api.tools.lore_skill_import.execute("t2", {
      source: "vercel-labs/agent-skills",
      skills: ["frontend-design"],
      visibility_client_types: ["openclaw"],
    });
    expect(run.details.ok).toBe(true);
    expect(run.content[0].text).toContain("Import from vercel-labs/agent-skills@main: 1 created, 1 exists, 1 failed");
    expect(run.content[0].text).toContain("- frontend-design: created (skill_id: skill-import-1)");
    expect(run.content[0].text).toContain("- broken: failed — bad SKILL.md frontmatter");
    expect(run.details.result.repo).toBe("vercel-labs/agent-skills");

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.url).toContain("/api/skills/import?client_type=openclaw");
    }
    expect(calls[0].body).toEqual({
      source: "npx skills add vercel-labs/agent-skills --skill frontend-design",
      dry_run: true,
    });
    expect(calls[1].body).toEqual({
      source: "vercel-labs/agent-skills",
      skills: ["frontend-design"],
      visibility_client_types: ["openclaw"],
    });

    const missing = await api.tools.lore_skill_import.execute("t3", {});
    expect(missing.details.ok).toBe(false);
    expect(missing.details.error).toMatch(/source is required/);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });
});

describe("skills lifecycle discovery hooks", () => {
  let loreHome: string;
  const projectId = "proj-life";

  beforeEach(() => {
    loreHome = makeTempHome();
    process.env.LORE_HOME = loreHome;
  });

  afterEach(() => {
    delete process.env.LORE_HOME;
    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  function makeMockApi() {
    const events: Record<string, any> = {};
    return {
      events,
      registerGatewayMethod() {},
      on(event: string, handler: any, options?: any) {
        events[event] = { handler, options };
      },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };
  }

  it("never declares features.skills on lifecycle requests", async () => {
    const pluginCfg = {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    };
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (url: string, init: any) => {
      if (String(url).includes("/api/skills")) {
        return { ok: false, status: 500, statusText: "ERR", text: async () => "should not sync" };
      }
      const body = JSON.parse(String(init?.body || "{}"));
      bodies.push(body);
      const value = body.event.name === "session.start"
        ? { appendSystemContext: "SYS\n<available_skills>catalog</available_skills>" }
        : { prependContext: "<skill_invocation>x</skill_invocation>" };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ host_output: { mode: "return_value", value } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = makeMockApi();
    registerHooks(api as any, pluginCfg);
    await api.events.session_start.handler({ sessionId: "sess-s" }, { sessionId: "sess-s" });
    const turn = await api.events.before_prompt_build.handler(
      { prompt: "run $deploy", messages: [] },
      { sessionId: "sess-s" },
    );
    expect(bodies.map((body) => body.features)).toEqual([undefined, { memory_recall: false }]);
    expect(turn.appendSystemContext).toBe("SYS\n<available_skills>catalog</available_skills>");
    expect(turn.prependContext).toBe("<skill_invocation>x</skill_invocation>");
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/api/skills"))).toBe(true);
    expect(fs.existsSync(path.join(loreHome, "skills"))).toBe(false);
  });

  it("session_start fire-and-forget syncs the catalog into the native skills root", async () => {
    const skillsRoot = makeTempHome();
    const pluginCfg = {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
      skillsEnabled: true,
    };
    const detail = skillDetail({
      id: "skill-sync",
      name: "synced-skill",
      project_id: projectId,
      version: 3,
      content: "# Synced\n",
    });

    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes(`/api/skills/${encodeURIComponent("skill-sync")}`)) {
        return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(detail) };
      }
      if (u.includes("/api/skills")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            project_id: projectId,
            catalog_revision: "rev-9",
            skills: [{ skill_id: "skill-sync", name: "synced-skill", version: 3, manifest_hash: detail.manifest_hash }],
          }),
        };
      }
      if (u.includes("/lifecycle/event")) {
        bodies.push(JSON.parse(String(init?.body || "{}")));
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          host_output: { mode: "return_value", value: { appendSystemContext: "SYS" } },
        }),
      };
    }));

    const api = makeMockApi();
    registerHooks(api as any, pluginCfg, { skillsRoot });
    await api.events.session_start.handler({ sessionId: "sess-s" }, { sessionId: "sess-s" });

    const statusPath = path.join(skillsRoot, ".lore-sync-status.json");
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !fs.existsSync(statusPath)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(status.created).toEqual(["synced-skill"]);
    expect(status.errors).toEqual([]);
    expect(status.project_id).toBe(projectId);
    expect(fs.readFileSync(path.join(skillsRoot, "synced-skill", "SKILL.md"), "utf-8")).toBe("# Synced\n");
    expect(fs.existsSync(path.join(skillsRoot, "synced-skill", ".lore-skill-marker.json"))).toBe(true);
    // The lifecycle startup request never declares a skills feature.
    expect(bodies.map((body) => body.features)).toEqual([undefined]);

    rmTempHome(skillsRoot);
  });
});

describe("build artifact packages vendor", () => {
  it("dist vendor workcopy is present and importable after build", async () => {
    const distVendor = path.join(process.cwd(), "dist", "vendor", "skill-workcopy", "index.mjs");
    const distSync = path.join(process.cwd(), "dist", "vendor", "skill-workcopy", "skills-sync.mjs");
    const srcVendor = path.join(process.cwd(), "vendor", "skill-workcopy", "index.mjs");
    const distSkills = path.join(process.cwd(), "dist", "skills.js");
    expect(fs.existsSync(srcVendor)).toBe(true);
    expect(fs.existsSync(distVendor)).toBe(true);
    expect(fs.existsSync(distSkills)).toBe(true);
    const distSkillsSrc = fs.readFileSync(distSkills, "utf-8");
    expect(distSkillsSrc).toContain("./vendor/skill-workcopy/index.mjs");
    const mod = await import(distVendor);
    expect(typeof mod.materializeSkillWorkCopy).toBe("function");
    const sync = await import(distSync);
    expect(typeof sync.runSkillsSync).toBe("function");
    const hooksSrc = fs.readFileSync(path.join(process.cwd(), "hooks.ts"), "utf-8");
    expect(hooksSrc).toContain("./vendor/skill-workcopy/skills-sync.mjs");
    expect(hooksSrc).toContain("runSkillsSync");
    const distHooks = fs.readFileSync(path.join(process.cwd(), "dist", "hooks.js"), "utf-8");
    expect(distHooks).toContain("./vendor/skill-workcopy/skills-sync.mjs");
  });

  it("materialize via vendor writes under loreHome skills tree", () => {
    const loreHome = makeTempHome();
    const detail = skillDetail({ project_id: "p", name: "build-skill", id: "s-build" });
    const { installPath } = materializeSkillWorkCopy({
      loreHome,
      projectId: "p",
      detail,
    });
    expect(installPath.startsWith(path.join(loreHome, "skills", "p"))).toBe(true);
    expect(fs.existsSync(path.join(installPath, "SKILL.md"))).toBe(true);
    rmTempHome(loreHome);
  });
});
