import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillsSession,
  ensureSkillWorkCopy,
  registerSkillTools,
  resolveLoreHome,
} from "../skills";
import { registerHooks } from "../hooks";
import { registerTools } from "../tools";
import {
  computeManifestHash,
  LORE_SKILL_MARKER,
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
      "lore_skill_get",
      "lore_skill_create",
      "lore_skill_update",
      "lore_skill_delete",
      "lore_skill_status",
    ];
    for (const name of skillTools) {
      expect(api.tools[name]).toBeDefined();
      expect(api.tools[name].promptSnippet).toBeUndefined();
      expect(api.tools[name].promptGuidelines).toBeUndefined();
      expect(api.tools[name].guidance).toBeUndefined();
    }
    expect(api.tools.lore_skill_artifact_create).toBeUndefined();
    expect(Object.keys(api.tools)).toHaveLength(16);
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

  it("lore_skill_get materializes a local work copy (dir writable 0755, managed files read-only 0444)", async () => {
    const loreHome = makeTempHome();
    const projectId = "proj-get";
    const detail = skillDetail({
      name: "get-skill",
      id: "skill-get",
      project_id: projectId,
      version: 1,
      content: "# Get Me\n",
    });
    detail.files = [{
      path: "SKILL.md",
      content: "# Get Me\n",
      sha256: sha256Text("# Get Me\n"),
      size: Buffer.byteLength("# Get Me\n", "utf-8"),
    }];
    detail.manifest_hash = computeManifestHash(
      detail.files.map((f: any) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    );

    const api = makeMockApi();
    const pluginCfg = { baseUrl: "http://host", apiToken: "", timeoutMs: 1000, loreHome };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(api as any, pluginCfg, session);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/skills/skill-get")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => "missing" };
    }));

    const result = await api.tools.lore_skill_get.execute("t", { skill_id: "skill-get" });
    expect(result.details.ok).toBe(true);
    expect(result.details.skill_md).toBe("# Get Me\n");
    expect(result.details.skill_dir).toBe(
      path.resolve(path.join(loreHome, "skill-artifacts", projectId, "get-skill")),
    );
    expect(result.details.downloaded).toBe(true);
    expect(result.content[0].text).toContain("skill_dir:");
    expect(fs.existsSync(path.join(result.details.skill_dir, LORE_SKILL_MARKER))).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(result.details.skill_dir).mode & 0o777).toBe(0o755);
      expect(fs.statSync(path.join(result.details.skill_dir, "SKILL.md")).mode & 0o777).toBe(0o444);
    }

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it("extra local files in the skill dir do not trigger tamper and survive a same-version get", async () => {
    const loreHome = makeTempHome();
    const projectId = "proj-extra";
    const detail = skillDetail({
      name: "extra-skill",
      id: "skill-extra",
      project_id: projectId,
      version: 2,
      content: "# Extra\n",
    });
    detail.files = [{
      path: "SKILL.md",
      content: "# Extra\n",
      sha256: sha256Text("# Extra\n"),
      size: Buffer.byteLength("# Extra\n", "utf-8"),
    }];
    detail.manifest_hash = computeManifestHash(
      detail.files.map((f: any) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    );

    const api = makeMockApi();
    const pluginCfg = { baseUrl: "http://host", apiToken: "", timeoutMs: 1000, loreHome };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(api as any, pluginCfg, session);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/skills/skill-extra")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => "missing" };
    }));

    const first = await api.tools.lore_skill_get.execute("t", { skill_id: "skill-extra" });
    expect(first.details.downloaded).toBe(true);
    expect(first.details.skill_md).toBe("# Extra\n");

    // The skill dir is writable: agents can create local outputs directly inside it.
    const skillDir = first.details.skill_dir;
    fs.mkdirSync(path.join(skillDir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(skillDir, "outputs", "notes.md"), "local notes\n", "utf-8");

    // Same-version get reuses the local copy; the extra local file is not tamper and survives.
    const again = await api.tools.lore_skill_get.execute("t2", { skill_id: "skill-extra" });
    expect(again.details.downloaded).toBe(false);
    expect(again.details.skill_md).toBe("# Extra\n");
    expect(fs.readFileSync(path.join(skillDir, "outputs", "notes.md"), "utf-8")).toBe("local notes\n");

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it("a managed-file modification triggers restore (downloaded=true) while the extra local file survives", async () => {
    const loreHome = makeTempHome();
    const projectId = "proj-restore";
    const detail = skillDetail({
      name: "restore-skill",
      id: "skill-restore",
      project_id: projectId,
      version: 3,
      content: "# Restore\n",
    });
    detail.files = [{
      path: "SKILL.md",
      content: "# Restore\n",
      sha256: sha256Text("# Restore\n"),
      size: Buffer.byteLength("# Restore\n", "utf-8"),
    }];
    detail.manifest_hash = computeManifestHash(
      detail.files.map((f: any) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    );

    const api = makeMockApi();
    const pluginCfg = { baseUrl: "http://host", apiToken: "", timeoutMs: 1000, loreHome };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(api as any, pluginCfg, session);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/skills/skill-restore")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => "missing" };
    }));

    const first = await api.tools.lore_skill_get.execute("t", { skill_id: "skill-restore" });
    expect(first.details.downloaded).toBe(true);
    expect(first.details.skill_md).toBe("# Restore\n");

    // Add an extra local file, then tamper with a server-managed file.
    const skillDir = first.details.skill_dir;
    fs.writeFileSync(path.join(skillDir, "extra.md"), "keep me\n", "utf-8");
    fs.chmodSync(path.join(skillDir, "SKILL.md"), 0o644);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# edited locally\n", "utf-8");

    // Tampered managed files are restored from server state; the extra local file survives.
    const again = await api.tools.lore_skill_get.execute("t2", { skill_id: "skill-restore" });
    expect(again.details.downloaded).toBe(true);
    expect(again.details.skill_md).toBe("# Restore\n");
    expect(fs.readFileSync(path.join(skillDir, "extra.md"), "utf-8")).toBe("keep me\n");

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it("ensureSkillWorkCopy uses shared adapter loadSkill path", async () => {
    const loreHome = makeTempHome();
    const projectId = "proj-ensure";
    const detail = skillDetail({ project_id: projectId, version: 3, content: "# Ensure\n" });
    detail.files = [{
      path: "SKILL.md",
      content: "# Ensure\n",
      sha256: sha256Text("# Ensure\n"),
      size: Buffer.byteLength("# Ensure\n", "utf-8"),
    }];
    detail.manifest_hash = computeManifestHash(
      detail.files.map((f: any) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    );

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/skills/skill-1")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: "NO", text: async () => "missing" };
    }));

    const result = await ensureSkillWorkCopy({
      pluginCfg: { baseUrl: "http://host", apiToken: "", timeoutMs: 1000, loreHome },
      loreHome,
      skillId: "skill-1",
      projectId,
    });
    expect(result.downloaded).toBe(true);
    expect(result.skill_md).toBe("# Ensure\n");
    expect(result.skill_dir).toBe(
      path.resolve(path.join(loreHome, "skill-artifacts", projectId, "demo-skill")),
    );

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

  it("opts into Skills context and writes host output through unchanged", async () => {
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
    registerHooks(api as any, pluginCfg, createSkillsSession(pluginCfg));
    await api.events.session_start.handler({ sessionId: "sess-s" }, { sessionId: "sess-s" });
    const turn = await api.events.before_prompt_build.handler(
      { prompt: "run $deploy", messages: [] },
      { sessionId: "sess-s" },
    );
    expect(bodies.map((body) => body.features)).toEqual([{ skills: true }, { memory_recall: false, skills: true }]);
    expect(turn.appendSystemContext).toBe("SYS\n<available_skills>catalog</available_skills>");
    expect(turn.prependContext).toBe("<skill_invocation>x</skill_invocation>");
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/api/skills"))).toBe(true);
    expect(fs.existsSync(path.join(loreHome, "skill-artifacts"))).toBe(false);
  });

  it("session_start records project/catalog identity only and never downloads or reconciles", async () => {
    const pluginCfg = {
      baseUrl: "http://host",
      apiToken: "",
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    };

    const apiCalls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes("/api/skills")) apiCalls.push(u);
      if (u.includes("/lifecycle/event")) {
        const body = JSON.parse(String(init?.body || "{}"));
        if (body?.event?.name === "session.start") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({
              host_output: { mode: "return_value", value: { appendSystemContext: "SYS" } },
              skill_catalog: { project_id: projectId, catalog_revision: "cat-1" },
            }),
          };
        }
      }
      return { ok: true, status: 200, text: async () => "{}" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = makeMockApi();
    const skills = createSkillsSession(pluginCfg);
    registerHooks(api as any, pluginCfg, skills);
    await api.events.session_start.handler({ sessionId: "sess-s" }, { sessionId: "sess-s" });
    expect(skills.state.projectId).toBe(projectId);
    expect(skills.state.catalogRevision).toBe("cat-1");
    // Session start never downloads or reconciles: no skill API calls.
    expect(apiCalls.some((u) => u.includes("/api/skills"))).toBe(false);
    expect(fs.existsSync(path.join(loreHome, "skill-artifacts", projectId))).toBe(false);
  });
});

describe("build artifact packages vendor", () => {
  it("dist vendor workcopy is present and importable after build", async () => {
    const distVendor = path.join(process.cwd(), "dist", "vendor", "skill-workcopy", "index.mjs");
    const srcVendor = path.join(process.cwd(), "vendor", "skill-workcopy", "index.mjs");
    const distSkills = path.join(process.cwd(), "dist", "skills.js");
    expect(fs.existsSync(srcVendor)).toBe(true);
    expect(fs.existsSync(distVendor)).toBe(true);
    expect(fs.existsSync(distSkills)).toBe(true);
    const distSkillsSrc = fs.readFileSync(distSkills, "utf-8");
    expect(distSkillsSrc).toContain("./vendor/skill-workcopy/index.mjs");
    const mod = await import(distVendor);
    expect(typeof mod.ensureSkillWorkCopy).toBe("function");
    expect(typeof mod.materializeSkillWorkCopy).toBe("function");
    const skillsSrc = fs.readFileSync(path.join(process.cwd(), "skills.ts"), "utf-8");
    expect(skillsSrc).toContain("./vendor/skill-workcopy/index.mjs");
    expect(skillsSrc).toContain("ensureSkillWorkCopy");
  });

  it("materialize via vendor writes under loreHome skill-artifacts tree", () => {
    const loreHome = makeTempHome();
    const detail = skillDetail({ project_id: "p", name: "build-skill", id: "s-build" });
    const { installPath } = materializeSkillWorkCopy({
      loreHome,
      projectId: "p",
      detail,
    });
    expect(installPath.startsWith(path.join(loreHome, "skill-artifacts", "p"))).toBe(true);
    expect(fs.existsSync(path.join(installPath, "SKILL.md"))).toBe(true);
    rmTempHome(loreHome);
  });
});
