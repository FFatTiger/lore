/**
 * Test scenarios for recall benchmark — built from PRODUCTION data.
 *
 * Source: recall/debug API against localhost:18901 (2026-04-03)
 * All scores are real retrieval scores from Qwen3-Embedding-0.6B + glm-5.1 views.
 *
 * Production memory universe (28 nodes):
 *   core://soul                                               (p=0) glossary: [Siri]
 *   core://agent                                           (p=1) glossary: [AI定时任务, backups, Docker部署, Portainer, PM2, PM2部署, 部署路由, ...]
 *   core://agent/openclaw/search_and_extract_routing                (p=1) glossary: [browser, SearXNG, web_search, 浏览器, ...]
 *   core://agent/openclaw/workspace_directory_structure              (p=1) glossary: [backups, scripts, tmp, 目录结构, ...]
 *   core://agent/openclaw/cli_and_opencode_conventions              (p=2) glossary: [clawdbot, openclaw CLI]
 *   core://agent/docker_image_architecture_check           (p=2) glossary: [amd64, arm64, Docker, Docker Hub, ...]
 *   core://agent/github_push_transport                     (p=2) glossary: [GitHub push, git push, ssh.github.com, ...]
 *   core://docker_hub_login                                   (p=2) glossary: [docker, Docker Hub, fffattiger, push]
 *   preferences://user                                        (p=0) glossary: [大哥, 用户偏好, 搜索偏好, SearXNG, ...]
 *   preferences://channels                                    (p=1) glossary: [reply_to_current]
 *   preferences://channels/imessage_format                    (p=1) glossary: [imessage]
 *   preferences://channels/telegram_format                    (p=1) glossary: [telegram, 表格]
 *   preferences://channels/wechat_channel                     (p=1) glossary: [wechat, 微信, 微信推送, ...]
 *   project://hltv_reminder                                   (p=1) glossary: [HLTV]
 *   project://nocturne_openclaw_integration                   (p=1) glossary: [embedded mcp server, Lore接入, recall_events, ...]
 *   project://nocturne_openclaw_integration/main_deploy_blocker_ed24555  (p=2)
 *   project://nocturne_openclaw_integration/production_deploy_2026_04_03 (p=2) glossary: [Portainer stack 158, ...]
 *   project://nocturne_openclaw_integration/recall_v2_plan    (p=2) glossary: [recall debug api, multi-view recall, ...]
 *   project://patalk_plugin                                   (p=1) glossary: [PaTalk]
 *   project://subtitle_automation                             (p=1) glossary: [字幕自动化, auto_subtitle, whisper]
 *   project://daily_hackernews_summary_imessage               (p=2) glossary: [HackerNews, HN, 每日精选]
 *   project://daily_stock_report_imessage                     (p=2) glossary: [stock report, 收盘报表]
 *   project://daily_weather_imessage                          (p=2) glossary: [weather, 天气, 南山区]
 *   project://gpt_account_automation                          (p=2) glossary: [chatgpt, CPA, gpt账号, Plus开通]
 *   project://immich                                          (p=2) glossary: [Immich, 照片服务]
 *   project://temp_mail_services                              (p=2) glossary: []
 *   project://codex_console_registration                      (p=3) glossary: [codex-console, HuuMail]
 *   project://codex_remote_registrar                          (p=3) glossary: [Browserbase, codex-reg]
 */

function mkMeta(glossaryTerms = [], cueTerms = []) {
  return { glossary_terms: glossaryTerms, cue_terms: cueTerms };
}

function exactRow(uri, exactScore, priority = 2, opts = {}) {
  return {
    uri,
    exact_score: exactScore,
    weight: 1.0,
    priority,
    disclosure: opts.disclosure || '',
    path_exact_hit: opts.path_exact_hit || false,
    glossary_exact_hit: opts.glossary_exact_hit || false,
    glossary_text_hit: opts.glossary_text_hit || false,
    query_contains_glossary_hit: opts.query_contains_glossary_hit || false,
    metadata: mkMeta(opts.glossary || [], opts.cues || []),
    view_type: 'exact',
  };
}

function denseRow(uri, semanticScore, viewType = 'gist', priority = 2, opts = {}) {
  return {
    uri,
    semantic_score: semanticScore,
    view_type: viewType,
    weight: viewType === 'gist' ? 1.0 : 0.96,
    priority,
    disclosure: opts.disclosure || '',
    metadata: {
      ...mkMeta(opts.glossary || [], opts.cues || []),
      llm_refined: true,
      llm_model: 'test',
    },
  };
}

function lexicalRow(uri, lexicalScore, viewType = 'gist', priority = 2, opts = {}) {
  return {
    uri,
    lexical_score: lexicalScore,
    view_type: viewType,
    weight: viewType === 'gist' ? 1.0 : 0.96,
    priority,
    disclosure: opts.disclosure || '',
    fts_hit: opts.fts_hit !== false,
    text_hit: opts.text_hit || false,
    uri_hit: opts.uri_hit || false,
    metadata: {
      ...mkMeta(opts.glossary || [], opts.cues || []),
      llm_refined: true,
      llm_model: 'test',
    },
  };
}

function gsRow(uri, score, keyword, priority = 2, opts = {}) {
  return {
    uri,
    glossary_semantic_score: score,
    keyword,
    priority,
    disclosure: opts.disclosure || '',
    metadata: mkMeta(opts.glossary || [keyword], []),
  };
}

// ─── Scenario definitions (from production recall/debug) ─────────────

export const scenarios = [

  // ====== Category 1: Exact Identity Match ======
  // Queries that should trigger exact match on glossary keywords

  {
    id: 'prod_siri_identity',
    category: 'exact_identity',
    description: 'Query "Siri" — exact glossary match on core://soul, should rank #1 despite noise',
    exactRows: [
      exactRow('core://soul', 0.980, 0, { glossary_exact_hit: true, glossary: ['Siri'] }),
    ],
    glossarySemanticRows: [
      gsRow('core://soul', 1.000, 'Siri', 0),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.341, 'searxng_search', 1),
      gsRow('preferences://user', 0.319, 'SearXNG', 0),
      gsRow('core://agent', 0.315, 'AI定时任务', 1),
      gsRow('preferences://channels/wechat_channel', 0.301, '微信', 1),
    ],
    denseRows: [
      denseRow('core://soul', 0.449, 'gist', 0),
      denseRow('preferences://user', 0.245, 'gist', 0),
      denseRow('project://daily_weather_imessage', 0.243, 'question', 2),
      denseRow('core://agent', 0.240, 'question', 1),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.239, 'gist', 1),
    ],
    lexicalRows: [
      lexicalRow('core://soul', 0.000, 'gist', 0, { fts_hit: true }),
    ],
    expected: { relevant_uris: ['core://soul'], top1: 'core://soul' },
  },

  {
    id: 'prod_dage_user',
    category: 'exact_identity',
    description: 'Query "大哥" — exact match on preferences://user, many lexical distractors',
    exactRows: [
      exactRow('preferences://user', 0.980, 0, { glossary_exact_hit: true, glossary: ['大哥'] }),
    ],
    glossarySemanticRows: [
      gsRow('preferences://user', 1.000, '大哥', 0),
      gsRow('project://gpt_account_automation', 0.223, 'Plus开通', 2),
      gsRow('project://codex_console_registration', 0.215, 'codex-console', 3),
    ],
    denseRows: [
      denseRow('preferences://user', 0.411, 'gist', 0),
      denseRow('project://immich', 0.340, 'gist', 2),
      denseRow('preferences://channels/wechat_channel', 0.339, 'question', 1),
      denseRow('project://temp_mail_services', 0.275, 'gist', 2),
      denseRow('preferences://channels/wechat_channel', 0.263, 'gist', 1),
    ],
    lexicalRows: [
      lexicalRow('preferences://user', 0.091, 'gist', 0, { fts_hit: true }),
      lexicalRow('core://agent', 0.000, 'gist', 1),
      lexicalRow('preferences://channels/wechat_channel', 0.000, 'gist', 1),
      lexicalRow('project://immich', 0.000, 'gist', 2),
    ],
    expected: { relevant_uris: ['preferences://user'], top1: 'preferences://user' },
  },

  {
    id: 'prod_subtitle_automation',
    category: 'exact_identity',
    description: 'Query "字幕自动化" — perfect glossary match + strong semantic, lexical also fires',
    exactRows: [
      exactRow('project://subtitle_automation', 0.980, 1, { glossary_exact_hit: true, glossary: ['字幕自动化'] }),
    ],
    glossarySemanticRows: [
      gsRow('project://subtitle_automation', 1.000, '字幕自动化', 1),
      gsRow('project://subtitle_automation', 0.638, 'auto_subtitle', 1),
      gsRow('core://agent/openclaw/workspace_directory_structure', 0.318, 'scripts', 1),
      gsRow('core://agent', 0.298, 'AI定时任务', 1),
    ],
    denseRows: [
      denseRow('project://subtitle_automation', 0.650, 'question', 1),
      denseRow('project://subtitle_automation', 0.543, 'gist', 1),
      denseRow('project://gpt_account_automation', 0.372, 'question', 2),
      denseRow('core://agent', 0.239, 'question', 1),
    ],
    lexicalRows: [
      lexicalRow('project://subtitle_automation', 0.091, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://subtitle_automation', 0.000, 'question', 1),
    ],
    expected: { relevant_uris: ['project://subtitle_automation'], top1: 'project://subtitle_automation' },
  },

  // ====== Category 2: Keyword + Exact (multi-signal strong match) ======

  {
    id: 'prod_user_preferences',
    category: 'keyword_exact',
    description: 'Query "用户偏好" — exact + perfect GS match on preferences://user',
    exactRows: [
      exactRow('preferences://user', 0.980, 0, { glossary_exact_hit: true, glossary: ['用户偏好'] }),
    ],
    glossarySemanticRows: [
      gsRow('preferences://user', 1.000, '用户偏好', 0),
      gsRow('preferences://user', 0.710, '搜索偏好', 0),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.305, 'event.prompt only', 2),
      gsRow('project://daily_hackernews_summary_imessage', 0.269, '每日精选', 2),
      gsRow('core://agent', 0.258, '对外预览', 1),
    ],
    denseRows: [
      denseRow('preferences://user', 0.455, 'question', 0),
      denseRow('preferences://user', 0.367, 'gist', 0),
      denseRow('preferences://channels', 0.337, 'question', 1),
      denseRow('core://agent', 0.306, 'gist', 1),
      denseRow('project://patalk_plugin', 0.285, 'question', 1),
    ],
    lexicalRows: [],
    expected: { relevant_uris: ['preferences://user'], top1: 'preferences://user' },
  },

  {
    id: 'prod_docker_deploy',
    category: 'keyword_exact',
    description: 'Query "docker部署" — 3 exact hits, strong GS, multi-node competition',
    exactRows: [
      exactRow('core://agent', 0.980, 1, { glossary_exact_hit: true, glossary: ['Docker部署'] }),
      exactRow('core://docker_hub_login', 0.840, 2, { glossary_text_hit: true, glossary: ['docker'] }),
      exactRow('core://agent/docker_image_architecture_check', 0.840, 2, { glossary_text_hit: true, glossary: ['Docker'] }),
    ],
    glossarySemanticRows: [
      gsRow('core://agent', 0.986, 'Docker部署', 1),
      gsRow('core://docker_hub_login', 0.739, 'docker', 2),
      gsRow('core://agent/docker_image_architecture_check', 0.738, 'Docker', 2),
      gsRow('core://docker_hub_login', 0.536, 'Docker Hub', 2),
      gsRow('core://agent', 0.528, '部署路由', 1),
      gsRow('project://nocturne_openclaw_integration', 0.486, 'docker hub latest', 1),
    ],
    denseRows: [
      denseRow('core://agent', 0.462, 'gist', 1),
      denseRow('core://agent/docker_image_architecture_check', 0.460, 'gist', 2),
      denseRow('core://agent/docker_image_architecture_check', 0.427, 'question', 2),
      denseRow('core://docker_hub_login', 0.411, 'question', 2),
      denseRow('core://docker_hub_login', 0.385, 'gist', 2),
      denseRow('project://immich', 0.346, 'gist', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent', 'core://docker_hub_login', 'core://agent/docker_image_architecture_check'],
      top1: 'core://agent',
    },
  },

  {
    id: 'prod_portainer_stack',
    category: 'keyword_exact',
    description: 'Query "Portainer stack" — exact on 2 nodes, strong GS, lexical fires on 6 nodes',
    exactRows: [
      exactRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.900, 2, { glossary_text_hit: true }),
      exactRow('core://agent', 0.840, 1, { glossary_text_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://agent', 0.845, 'Portainer', 1),
      gsRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.817, 'Portainer stack 158', 2),
      gsRow('core://agent', 0.458, 'stack', 1),
      gsRow('core://agent', 0.417, 'Docker部署', 1),
      gsRow('core://agent/docker_image_architecture_check', 0.398, 'Docker', 2),
      gsRow('core://docker_hub_login', 0.374, 'docker', 2),
    ],
    denseRows: [
      denseRow('core://agent', 0.523, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration', 0.450, 'question', 1),
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.439, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.435, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.397, 'gist', 1),
    ],
    lexicalRows: [
      lexicalRow('core://agent', 0.155, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.091, 'gist', 1, { fts_hit: true }),
      lexicalRow('core://agent/docker_image_architecture_check', 0.091, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.091, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.091, 'question', 1, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['core://agent', 'project://nocturne_openclaw_integration/production_deploy_2026_04_03'],
      top1: 'core://agent',
    },
  },

  // ====== Category 3: Pure Semantic / No Exact ======

  {
    id: 'prod_deploy_nocturne',
    category: 'semantic',
    description: 'Query "部署nocturne" — no exact hit, GS below 0.88 threshold, dense is main signal',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('project://nocturne_openclaw_integration', 0.788, 'Lore接入', 1),
      gsRow('core://agent', 0.697, 'lore.db', 1),
      gsRow('project://nocturne_openclaw_integration', 0.697, 'lore.db', 1),
      gsRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.617, 'lore', 2),
      gsRow('core://agent', 0.510, '部署路由', 1),
      gsRow('project://nocturne_openclaw_integration', 0.487, 'fffattiger/lore:latest', 1),
      gsRow('core://agent', 0.450, 'PM2部署', 1),
      gsRow('core://agent', 0.396, 'Docker部署', 1),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.637, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.617, 'question', 1),
      denseRow('project://nocturne_openclaw_integration', 0.591, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.563, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/main_deploy_blocker_ed24555', 0.491, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.479, 'question', 2),
      denseRow('core://agent', 0.350, 'gist', 1),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['project://nocturne_openclaw_integration', 'project://nocturne_openclaw_integration/production_deploy_2026_04_03'],
      top1: 'project://nocturne_openclaw_integration',
      // The GS threshold problem: 0.788 is below 0.88, so current system ignores the best GS signal
    },
  },

  {
    id: 'prod_cron_config',
    category: 'semantic',
    description: 'Query "定时任务怎么配置" — core://agent has the rules, but daily_* projects compete on dense',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('core://agent', 0.651, 'AI定时任务', 1),
      gsRow('preferences://user', 0.430, '异步任务', 0),
      gsRow('core://agent', 0.313, 'OpenClaw cron', 1),
    ],
    denseRows: [
      denseRow('core://agent', 0.534, 'question', 1),
      denseRow('project://daily_weather_imessage', 0.428, 'question', 2),
      denseRow('project://daily_stock_report_imessage', 0.414, 'question', 2),
      denseRow('project://temp_mail_services', 0.379, 'question', 2),
      denseRow('project://daily_hackernews_summary_imessage', 0.361, 'question', 2),
      denseRow('core://agent', 0.335, 'gist', 1),
      denseRow('project://daily_stock_report_imessage', 0.332, 'gist', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent'],
      top1: 'core://agent',
      // Problem: daily_* projects are noise — they happen to be cron jobs but don't explain "how to configure"
    },
  },

  {
    id: 'prod_recall_optimization',
    category: 'semantic',
    description: 'Query "recall优化" — recall_v2_plan should rank #1 via GS + dense, no exact hit',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.729, '/recall only', 2),
      gsRow('project://nocturne_openclaw_integration', 0.628, 'recall_events', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.628, 'recall_events', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.583, 'recall query sanitize', 2),
      gsRow('project://nocturne_openclaw_integration', 0.581, 'recall debug fixed', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.569, 'recall usage api', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.562, 'recall debug api', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.543, 'multi-view recall', 2),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.574, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.508, 'question', 2),
      denseRow('preferences://channels', 0.398, 'question', 1),
      denseRow('project://subtitle_automation', 0.373, 'question', 1),
      denseRow('core://agent', 0.367, 'question', 1),
      denseRow('project://hltv_reminder', 0.353, 'question', 1),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['project://nocturne_openclaw_integration/recall_v2_plan', 'project://nocturne_openclaw_integration'],
      top1: 'project://nocturne_openclaw_integration/recall_v2_plan',
      // All GS scores below 0.88 threshold — current system will ignore all glossary_semantic signal
    },
  },

  {
    id: 'prod_github_action',
    category: 'semantic',
    description: 'Query "github action" — no exact, GS points to github_push_transport, dense too',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('core://agent/github_push_transport', 0.561, 'GitHub push', 2),
      gsRow('core://agent/github_push_transport', 0.486, 'ssh.github.com', 2),
      gsRow('core://agent/github_push_transport', 0.404, 'gh auth', 2),
      gsRow('core://agent/github_push_transport', 0.387, 'git push', 2),
      gsRow('core://docker_hub_login', 0.360, 'Docker Hub', 2),
      gsRow('core://agent/docker_image_architecture_check', 0.360, 'Docker Hub', 2),
    ],
    denseRows: [
      denseRow('core://agent/github_push_transport', 0.474, 'question', 2),
      denseRow('core://agent/github_push_transport', 0.365, 'gist', 2),
      denseRow('project://gpt_account_automation', 0.346, 'gist', 2),
      denseRow('project://gpt_account_automation', 0.321, 'question', 2),
      denseRow('core://docker_hub_login', 0.313, 'question', 2),
      denseRow('core://docker_hub_login', 0.311, 'gist', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent/github_push_transport'],
      top1: 'core://agent/github_push_transport',
      // All GS below 0.88, dense max 0.474 — weak signals only
    },
  },

  // ====== Category 4: GS Threshold Problem ======
  // These expose the 0.88 threshold being too aggressive

  {
    id: 'prod_search_preference',
    category: 'gs_threshold',
    description: 'Query "搜索引擎偏好" — GS 0.892 just above threshold for preferences://user, search_routing also relevant',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('preferences://user', 0.892, '搜索偏好', 0),
      gsRow('preferences://user', 0.687, '用户偏好', 0),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.441, 'searxng_search', 1),
      gsRow('preferences://user', 0.405, 'web_search', 0),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.405, 'web_search', 1),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.397, 'search-layer', 1),
    ],
    denseRows: [
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.403, 'gist', 1),
      denseRow('preferences://channels', 0.304, 'question', 1),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.291, 'question', 1),
      denseRow('project://daily_hackernews_summary_imessage', 0.280, 'gist', 2),
      denseRow('preferences://user', 0.265, 'gist', 0),
      denseRow('preferences://user', 0.253, 'question', 0),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['preferences://user', 'core://agent/openclaw/search_and_extract_routing'],
      top1: 'preferences://user',
      // GS 0.892 barely passes 0.88 — if threshold were 0.90 this would be lost
    },
  },

  {
    id: 'prod_memory_backup',
    category: 'gs_threshold',
    description: 'Query "记忆整理备份" — best GS is 0.607 (core://agent memory-maintenance), all below threshold',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('core://agent', 0.607, 'memory-maintenance', 1),
      gsRow('core://agent', 0.495, 'backups', 1),
      gsRow('core://agent/openclaw/workspace_directory_structure', 0.495, 'backups', 1),
      gsRow('project://nocturne_openclaw_integration', 0.476, 'memory_views', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.476, 'memory_views', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.456, 'multi-view recall', 2),
      gsRow('core://agent', 0.450, '通用备份', 1),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.420, 'gist', 2),
      denseRow('project://daily_weather_imessage', 0.398, 'question', 2),
      denseRow('core://agent', 0.390, 'question', 1),
      denseRow('project://daily_stock_report_imessage', 0.363, 'question', 2),
      denseRow('project://daily_hackernews_summary_imessage', 0.360, 'question', 2),
      denseRow('core://agent/openclaw/workspace_directory_structure', 0.321, 'gist', 1),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent', 'core://agent/openclaw/workspace_directory_structure'],
      top1: 'core://agent',
      // ALL GS below 0.88 — current system treats this as if no glossary signal exists
    },
  },

  // ====== Category 5: Multi-Signal Competitive ======

  {
    id: 'prod_mcp_server',
    category: 'multi_signal',
    description: 'Query "MCP server" — 2 exact hits, strong GS for nocturne_integration, but dense points elsewhere',
    exactRows: [
      exactRow('project://nocturne_openclaw_integration', 0.900, 1, { glossary_text_hit: true }),
      exactRow('project://nocturne_openclaw_integration/main_deploy_blocker_ed24555', 0.900, 2, { glossary_text_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('project://nocturne_openclaw_integration', 0.820, 'embedded mcp server', 1),
      gsRow('project://nocturne_openclaw_integration/main_deploy_blocker_ed24555', 0.753, 'Embed MCP server in web app', 2),
      gsRow('project://nocturne_openclaw_integration', 0.643, '/api/mcp', 1),
      gsRow('project://gpt_account_automation', 0.371, 'CPA', 2),
      gsRow('project://nocturne_openclaw_integration/main_deploy_blocker_ed24555', 0.267, '@modelcontextprotocol/sdk', 2),
    ],
    denseRows: [
      denseRow('project://codex_remote_registrar', 0.277, 'question', 3),
      denseRow('project://immich', 0.276, 'gist', 2),
      denseRow('project://temp_mail_services', 0.265, 'question', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.241, 'question', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['project://nocturne_openclaw_integration', 'project://nocturne_openclaw_integration/main_deploy_blocker_ed24555'],
      top1: 'project://nocturne_openclaw_integration',
      // Dense points to completely irrelevant nodes — exact + GS must dominate
    },
  },

  {
    id: 'prod_browser_tool',
    category: 'multi_signal',
    description: 'Query "浏览器工具" — exact on search_routing, strong GS, dense split between search_routing and codex_registrar',
    exactRows: [
      exactRow('core://agent/openclaw/search_and_extract_routing', 0.840, 1, { glossary_text_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.758, '浏览器', 1),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.719, 'browser', 1),
      gsRow('project://codex_remote_registrar', 0.591, 'Browserbase', 3),
      gsRow('core://agent/openclaw/search_and_extract_routing', 0.562, 'agent-browser', 1),
      gsRow('core://agent', 0.433, 'filebrowser_share', 1),
      gsRow('preferences://user', 0.372, 'web_search', 0),
    ],
    denseRows: [
      denseRow('project://codex_remote_registrar', 0.443, 'question', 3),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.371, 'gist', 1),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.371, 'question', 1),
      denseRow('core://agent', 0.352, 'gist', 1),
      denseRow('project://codex_remote_registrar', 0.331, 'gist', 3),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent/openclaw/search_and_extract_routing'],
      top1: 'core://agent/openclaw/search_and_extract_routing',
      // codex_remote_registrar (Browserbase) is noise — it's a registrar, not a browser tool
    },
  },

  {
    id: 'prod_pm2_ecosystem',
    category: 'multi_signal',
    description: 'Query "PM2 ecosystem" — exact on core://agent, strong GS, but dense is noisy',
    exactRows: [
      exactRow('core://agent', 0.840, 1, { glossary_text_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://agent', 0.796, 'PM2', 1),
      gsRow('core://agent', 0.720, 'PM2部署', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.291, 'path_event aggregation', 2),
      gsRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.287, '0232cb3', 2),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.267, 'question', 2),
      denseRow('project://immich', 0.248, 'gist', 2),
      denseRow('project://patalk_plugin', 0.239, 'question', 1),
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.234, 'question', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent'],
      top1: 'core://agent',
      // Dense completely misses the target — only exact + GS find it
    },
  },

  // ====== Category 6: Lexical-Critical Scenarios ======

  {
    id: 'prod_portainer_lexical',
    category: 'lexical_critical',
    description: 'Isolated lexical test — what if only lexical + weak dense exist for Portainer',
    exactRows: [],
    glossarySemanticRows: [],
    denseRows: [
      denseRow('core://agent', 0.350, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration', 0.320, 'question', 1),
      denseRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.310, 'gist', 2),
    ],
    lexicalRows: [
      lexicalRow('core://agent', 0.155, 'gist', 1, { fts_hit: true, text_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.091, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration/production_deploy_2026_04_03', 0.091, 'gist', 2, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['core://agent'],
      top1: 'core://agent',
      // Lexical cap at 0.14 means 0.155 gets truncated — does the system still rank correctly?
    },
  },

  // ====== Category 7: Priority Differentiation ======

  {
    id: 'prod_priority_core_vs_project',
    category: 'priority',
    description: 'core://agent (p=1) vs project nodes (p=2) with similar dense scores',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('core://agent', 0.651, 'AI定时任务', 1),
    ],
    denseRows: [
      denseRow('core://agent', 0.534, 'question', 1),
      denseRow('project://daily_weather_imessage', 0.528, 'question', 2),
      denseRow('project://daily_stock_report_imessage', 0.514, 'question', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['core://agent'],
      top1: 'core://agent',
      // Scores are very close — priority should break the tie
    },
  },

  {
    id: 'prod_priority_p0_vs_noise',
    category: 'priority',
    description: 'preferences://user (p=0) competes with high-scoring noise from dense',
    exactRows: [],
    glossarySemanticRows: [
      gsRow('preferences://user', 0.892, '搜索偏好', 0),
    ],
    denseRows: [
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.403, 'gist', 1),
      denseRow('preferences://user', 0.265, 'gist', 0),
      denseRow('project://daily_hackernews_summary_imessage', 0.280, 'gist', 2),
    ],
    lexicalRows: [],
    expected: {
      relevant_uris: ['preferences://user', 'core://agent/openclaw/search_and_extract_routing'],
      top1: 'preferences://user',
      // p=0 node with moderate GS should beat p=1 node with higher dense but no GS
    },
  },

  // ====== Category 8: Long-Query Topical (real prod data, 2026-04-05) ======
  // These scenarios stress-test the long-query score inflation pathology.
  // Patterns captured: with 15-40 jieba tokens, ts_rank_cd inflates across
  // many nodes, exact path's FTS OR-match fires at 0.78 for ~all nodes.

  {
    id: 'long_topical_recall',
    category: 'long_topical',
    description: 'Long query (82 chars, 22 tokens) about recall scoring strategy. Target: recall_v2_plan wins all paths after FTS tokenization, but lexical gist is drowned by token-count noise.',
    query_tokens: 22,
    exactRows: [
      // FTS tokenization OR-match fires at 0.78 on ~all nodes for long queries
      // In production this query's target (recall_v2_plan) IS in exact because
      // the FTS tokens match its glossary keywords (recall, etc.)
      exactRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/wechat_channel', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/imessage_format', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/telegram_format', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://hltv_reminder', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://subtitle_automation', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://patalk_plugin', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://temp_mail_services', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.570, 'recall_events', 2),
      gsRow('project://nocturne_openclaw_integration', 0.532, 'recall_events', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.516, 'recall debug api', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.513, '/recall only', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.512, 'recall debug fixed', 2),
      gsRow('project://nocturne_openclaw_integration', 0.512, 'recall debug fixed', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.509, 'recall query sanitize', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.484, 'multi-view recall', 2),
      gsRow('project://nocturne_openclaw_integration', 0.483, 'recall usage api', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.482, 'recall usage api', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.481, 'glossary semantic layer', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.451, 'benchmark framework', 2),
      gsRow('project://nocturne_openclaw_integration', 0.428, 'drilldown landed', 1),
      gsRow('preferences://channels', 0.348, 'reply_to_current', 1),
      gsRow('core://agent', 0.345, '部署路由', 1),
      gsRow('project://codex_remote_registrar', 0.333, 'Browserbase', 3),
      gsRow('preferences://user', 0.331, 'SearXNG', 0),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.554, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.619, 'question', 2),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.419, 'gist', 1),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.462, 'question', 1),
      denseRow('project://daily_hackernews_summary_imessage', 0.362, 'gist', 2),
      denseRow('project://daily_hackernews_summary_imessage', 0.423, 'question', 2),
      denseRow('preferences://channels', 0.340, 'gist', 1),
      denseRow('preferences://channels', 0.453, 'question', 1),
      denseRow('project://subtitle_automation', 0.341, 'gist', 1),
      denseRow('project://subtitle_automation', 0.405, 'question', 1),
      denseRow('core://agent', 0.258, 'gist', 1),
      denseRow('core://agent', 0.403, 'question', 1),
      denseRow('project://codex_remote_registrar', 0.328, 'gist', 3),
      denseRow('core://soul', 0.325, 'gist', 0),
      denseRow('project://daily_stock_report_imessage', 0.324, 'gist', 2),
      denseRow('project://daily_stock_report_imessage', 0.396, 'question', 2),
      denseRow('preferences://user', 0.297, 'gist', 0),
      denseRow('project://hltv_reminder', 0.279, 'gist', 1),
      denseRow('project://hltv_reminder', 0.410, 'question', 1),
      denseRow('project://daily_weather_imessage', 0.244, 'gist', 2),
      denseRow('project://daily_weather_imessage', 0.408, 'question', 2),
      denseRow('project://temp_mail_services', 0.237, 'gist', 2),
      denseRow('project://temp_mail_services', 0.381, 'question', 2),
      denseRow('project://gpt_account_automation', 0.269, 'gist', 2),
      denseRow('project://gpt_account_automation', 0.374, 'question', 2),
      denseRow('project://immich', 0.228, 'gist', 2),
      denseRow('project://immich', 0.371, 'question', 2),
    ],
    lexicalRows: [
      // Noise nodes dominate lexical gist because their text is longer → more OR-matches
      lexicalRow('project://codex_console_registration', 0.863, 'gist', 3, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.857, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.839, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://codex_remote_registrar', 0.831, 'gist', 3, { fts_hit: true }),
      lexicalRow('core://agent/github_push_transport', 0.818, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.808, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent', 0.792, 'gist', 1, { fts_hit: true }),
      lexicalRow('preferences://channels/wechat_channel', 0.792, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://daily_weather_imessage', 0.792, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/docker_image_architecture_check', 0.787, 'gist', 2, { fts_hit: true }),
      // lexical question: target recall_v2_plan is top here
      lexicalRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.565, 'question', 2, { fts_hit: true }),
      lexicalRow('core://docker_hub_login', 0.524, 'question', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.444, 'question', 1, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.444, 'question', 2, { fts_hit: true }),
      lexicalRow('core://agent/github_push_transport', 0.412, 'question', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.412, 'question', 2, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['project://nocturne_openclaw_integration/recall_v2_plan'],
      top1: 'project://nocturne_openclaw_integration/recall_v2_plan',
      expected_max_top_score: 0.80,  // reasonable match but not "perfect" 0.97
    },
  },

  {
    id: 'long_topical_hackernews',
    category: 'long_topical',
    description: 'Long cron message (~921 chars, 166 tokens) delivering HackerNews digest. Target: daily_hackernews_summary_imessage — strong dense/lex on it since content IS the digest.',
    query_tokens: 166,
    exactRows: [
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://daily_hackernews_summary_imessage', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('project://daily_stock_report_imessage', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('project://daily_weather_imessage', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('project://hltv_reminder', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('project://daily_hackernews_summary_imessage', 0.782, 'HackerNews', 2),
      gsRow('project://daily_hackernews_summary_imessage', 0.761, 'HN', 2),
      gsRow('project://daily_hackernews_summary_imessage', 0.618, '每日精选', 2),
      gsRow('core://agent', 0.488, 'AI定时任务', 1),
      gsRow('core://agent', 0.413, 'OpenClaw cron', 1),
      gsRow('project://daily_stock_report_imessage', 0.385, 'stock report', 2),
      gsRow('project://daily_weather_imessage', 0.362, 'weather', 2),
    ],
    denseRows: [
      denseRow('project://daily_hackernews_summary_imessage', 0.762, 'gist', 2),
      denseRow('project://daily_hackernews_summary_imessage', 0.731, 'question', 2),
      denseRow('project://daily_stock_report_imessage', 0.434, 'gist', 2),
      denseRow('project://daily_stock_report_imessage', 0.498, 'question', 2),
      denseRow('project://daily_weather_imessage', 0.398, 'gist', 2),
      denseRow('project://daily_weather_imessage', 0.452, 'question', 2),
      denseRow('core://agent', 0.342, 'gist', 1),
      denseRow('core://agent', 0.421, 'question', 1),
      denseRow('project://hltv_reminder', 0.322, 'gist', 1),
      denseRow('project://hltv_reminder', 0.389, 'question', 1),
      denseRow('preferences://channels/wechat_channel', 0.301, 'gist', 1),
      denseRow('preferences://channels', 0.288, 'question', 1),
      denseRow('project://nocturne_openclaw_integration', 0.267, 'gist', 1),
      denseRow('project://subtitle_automation', 0.241, 'gist', 1),
    ],
    lexicalRows: [
      lexicalRow('project://daily_hackernews_summary_imessage', 0.923, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.856, 'question', 2, { fts_hit: true }),
      lexicalRow('project://daily_stock_report_imessage', 0.745, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://daily_weather_imessage', 0.722, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent', 0.687, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://codex_console_registration', 0.672, 'gist', 3, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.651, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.634, 'gist', 2, { fts_hit: true }),
      lexicalRow('preferences://channels/wechat_channel', 0.612, 'gist', 1, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['project://daily_hackernews_summary_imessage'],
      top1: 'project://daily_hackernews_summary_imessage',
      expected_max_top_score: 0.85,  // strong match across all paths
    },
  },

  {
    id: 'long_topical_deploy',
    category: 'long_topical',
    description: 'Mid-length conversation (~250 chars, 60 tokens) about docker deploy + portainer + recall. Target: workflow/docker nodes.',
    query_tokens: 60,
    exactRows: [
      exactRow('core://agent', 0.98, 1, { glossary_exact_hit: true, glossary: ['Docker部署'] }),
      exactRow('core://docker_hub_login', 0.84, 2, { glossary_text_hit: true, glossary: ['docker'] }),
      exactRow('core://agent/docker_image_architecture_check', 0.84, 2, { glossary_text_hit: true, glossary: ['Docker'] }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/github_push_transport', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('preferences://channels/wechat_channel', 0.78, 1, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://agent', 0.756, 'Docker部署', 1),
      gsRow('core://docker_hub_login', 0.682, 'Docker Hub', 2),
      gsRow('core://agent/docker_image_architecture_check', 0.668, 'Docker', 2),
      gsRow('core://agent', 0.612, 'Portainer', 1),
      gsRow('core://agent', 0.543, '部署路由', 1),
      gsRow('project://nocturne_openclaw_integration', 0.486, 'docker hub latest', 1),
      gsRow('core://agent', 0.445, 'PM2部署', 1),
    ],
    denseRows: [
      denseRow('core://agent', 0.512, 'gist', 1),
      denseRow('core://agent', 0.487, 'question', 1),
      denseRow('core://agent/docker_image_architecture_check', 0.462, 'gist', 2),
      denseRow('core://agent/docker_image_architecture_check', 0.434, 'question', 2),
      denseRow('core://docker_hub_login', 0.435, 'gist', 2),
      denseRow('core://docker_hub_login', 0.418, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.392, 'gist', 1),
      denseRow('project://immich', 0.346, 'gist', 2),
      denseRow('project://temp_mail_services', 0.301, 'gist', 2),
    ],
    lexicalRows: [
      lexicalRow('core://agent', 0.612, 'gist', 1, { fts_hit: true }),
      lexicalRow('core://docker_hub_login', 0.564, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/docker_image_architecture_check', 0.548, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.432, 'gist', 1, { fts_hit: true }),
      lexicalRow('core://agent/github_push_transport', 0.389, 'gist', 2, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['core://agent', 'core://docker_hub_login', 'core://agent/docker_image_architecture_check'],
      top1: 'core://agent',
      expected_max_top_score: 0.90,  // strong multi-signal match
    },
  },

  // ====== Category 9: Long-Query Noise (should NOT score high) ======

  {
    id: 'long_noise_system_exec',
    category: 'long_noise',
    description: 'Noise: system exec completed log (~1073 chars, 134 tokens) — no meaningful topical match. Top score should stay LOW.',
    query_tokens: 134,
    exactRows: [
      // FTS OR-match fires at 0.78 across ~all nodes for long noise
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/wechat_channel', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://hltv_reminder', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://subtitle_automation', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/workspace_directory_structure', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://docker_hub_login', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/cli_and_opencode_conventions', 0.78, 2, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      // moderate cosines scattered — no dominant
      gsRow('core://agent', 0.405, 'AI定时任务', 1),
      gsRow('core://agent', 0.378, 'backups', 1),
      gsRow('project://nocturne_openclaw_integration', 0.356, 'lore.db', 1),
      gsRow('preferences://user', 0.342, 'SearXNG', 0),
      gsRow('core://agent/openclaw/cli_and_opencode_conventions', 0.321, 'openclaw CLI', 2),
      gsRow('core://agent/openclaw/workspace_directory_structure', 0.312, '目录结构', 1),
      gsRow('core://soul', 0.298, 'Siri', 0),
      gsRow('core://docker_hub_login', 0.287, 'docker', 2),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.498, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.466, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.476, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration', 0.451, 'question', 1),
      denseRow('project://hltv_reminder', 0.444, 'gist', 1),
      denseRow('core://agent/openclaw/workspace_directory_structure', 0.423, 'gist', 1),
      denseRow('core://agent', 0.416, 'gist', 1),
      denseRow('core://agent', 0.402, 'question', 1),
      denseRow('core://agent/openclaw/cli_and_opencode_conventions', 0.398, 'gist', 2),
      denseRow('core://docker_hub_login', 0.385, 'gist', 2),
      denseRow('preferences://user', 0.372, 'gist', 0),
      denseRow('core://soul', 0.368, 'gist', 0),
    ],
    lexicalRows: [
      // inflated ts_rank_cd on nodes with long gists, unrelated to semantic fit
      lexicalRow('project://codex_console_registration', 0.712, 'gist', 3, { fts_hit: true }),
      lexicalRow('core://agent', 0.687, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.645, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.624, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.589, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.567, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://docker_hub_login', 0.534, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://codex_remote_registrar', 0.512, 'gist', 3, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: [],  // no meaningful answer
      top1: null,
      is_noise: true,
      expected_max_top_score: 0.45,  // anything above suggests false confidence
    },
  },

  {
    id: 'long_noise_conv_metadata',
    category: 'long_noise',
    description: 'Noise: conversation metadata JSON dump (~408 chars, 88 tokens) — no topical meaning.',
    query_tokens: 88,
    exactRows: [
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://soul', 0.389, 'Siri', 0),
      gsRow('preferences://channels', 0.371, 'reply_to_current', 1),
      gsRow('core://agent', 0.342, 'AI定时任务', 1),
      gsRow('preferences://user', 0.334, 'SearXNG', 0),
      gsRow('project://codex_remote_registrar', 0.312, 'session reuse', 3),
    ],
    denseRows: [
      denseRow('preferences://channels', 0.489, 'gist', 1),
      denseRow('core://soul', 0.486, 'gist', 0),
      denseRow('preferences://channels/wechat_channel', 0.461, 'gist', 1),
      denseRow('project://daily_hackernews_summary_imessage', 0.441, 'gist', 2),
      denseRow('project://codex_remote_registrar', 0.447, 'question', 3),
      denseRow('project://temp_mail_services', 0.442, 'gist', 2),
      denseRow('core://agent', 0.398, 'gist', 1),
      denseRow('preferences://user', 0.372, 'gist', 0),
    ],
    lexicalRows: [
      lexicalRow('project://codex_console_registration', 0.623, 'gist', 3, { fts_hit: true }),
      lexicalRow('core://agent', 0.587, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.556, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.512, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://codex_remote_registrar', 0.489, 'gist', 3, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: [],
      top1: null,
      is_noise: true,
      expected_max_top_score: 0.50,
    },
  },

  {
    id: 'long_noise_queued_msgs',
    category: 'long_noise',
    description: 'Noise: "Queued messages while agent was busy" system dump (~1308 chars, 145 tokens).',
    query_tokens: 145,
    exactRows: [
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://subtitle_automation', 0.78, 1, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      gsRow('core://soul', 0.412, 'Siri', 0),
      gsRow('core://agent', 0.378, 'AI定时任务', 1),
      gsRow('project://nocturne_openclaw_integration', 0.356, 'recall_events', 1),
      gsRow('preferences://channels', 0.342, 'reply_to_current', 1),
    ],
    denseRows: [
      denseRow('core://soul', 0.467, 'gist', 0),
      denseRow('core://agent', 0.454, 'gist', 1),
      denseRow('preferences://channels', 0.449, 'question', 1),
      denseRow('project://nocturne_openclaw_integration', 0.431, 'gist', 1),
      denseRow('project://subtitle_automation', 0.408, 'question', 1),
      denseRow('preferences://user', 0.378, 'gist', 0),
      denseRow('project://hltv_reminder', 0.362, 'question', 1),
    ],
    lexicalRows: [
      lexicalRow('core://agent', 0.734, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://codex_console_registration', 0.712, 'gist', 3, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.687, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.645, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.612, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.589, 'gist', 2, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: [],
      top1: null,
      is_noise: true,
      expected_max_top_score: 0.48,
    },
  },

  // ====== Category 10: Extra-Long Queries (2000+ chars, 300+ tokens) ======

  {
    id: 'xlong_noise_compaction_2k',
    category: 'xlong_noise',
    description: 'Extra-long noise (~2200 chars, ~420 tokens): pre-compaction memory flush with multi-turn conversation history.',
    query_tokens: 420,
    exactRows: [
      // FTS OR-match hits ALMOST every node at 0.78 for super-long queries
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/wechat_channel', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('preferences://channels/imessage_format', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('project://subtitle_automation', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://patalk_plugin', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://hltv_reminder', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/workspace_directory_structure', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/cli_and_opencode_conventions', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/search_and_extract_routing', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://docker_hub_login', 0.78, 2, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      // spread across many keywords, no dominant one
      gsRow('core://agent', 0.465, 'AI定时任务', 1),
      gsRow('core://soul', 0.451, 'Siri', 0),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.445, 'recall_events', 2),
      gsRow('project://nocturne_openclaw_integration', 0.432, 'recall_events', 1),
      gsRow('preferences://user', 0.418, 'SearXNG', 0),
      gsRow('core://agent', 0.402, 'backups', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.389, 'benchmark framework', 2),
      gsRow('preferences://channels', 0.376, 'reply_to_current', 1),
      gsRow('core://agent/openclaw/cli_and_opencode_conventions', 0.362, 'openclaw CLI', 2),
      gsRow('core://agent/openclaw/workspace_directory_structure', 0.348, '目录结构', 1),
    ],
    denseRows: [
      // many nodes with moderate cosines
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.512, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.489, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.498, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration', 0.476, 'question', 1),
      denseRow('core://agent', 0.467, 'gist', 1),
      denseRow('core://agent', 0.451, 'question', 1),
      denseRow('core://soul', 0.445, 'gist', 0),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.438, 'gist', 1),
      denseRow('core://agent/openclaw/cli_and_opencode_conventions', 0.425, 'gist', 2),
      denseRow('preferences://channels', 0.418, 'question', 1),
      denseRow('preferences://user', 0.412, 'gist', 0),
      denseRow('core://agent/openclaw/workspace_directory_structure', 0.405, 'gist', 1),
      denseRow('core://docker_hub_login', 0.389, 'gist', 2),
      denseRow('project://subtitle_automation', 0.376, 'question', 1),
    ],
    lexicalRows: [
      // with 420 tokens, EVERY node with gist content hits lex at high ts_rank_cd
      lexicalRow('project://codex_console_registration', 0.923, 'gist', 3, { fts_hit: true }),
      lexicalRow('core://agent', 0.912, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.897, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.884, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.871, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.856, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://codex_remote_registrar', 0.843, 'gist', 3, { fts_hit: true }),
      lexicalRow('core://agent/github_push_transport', 0.829, 'gist', 2, { fts_hit: true }),
      lexicalRow('preferences://channels/wechat_channel', 0.812, 'gist', 1, { fts_hit: true }),
      lexicalRow('core://agent/docker_image_architecture_check', 0.798, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.756, 'question', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.712, 'question', 1, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: [],
      top1: null,
      is_noise: true,
      expected_max_top_score: 0.45,
    },
  },

  {
    id: 'xlong_topical_session_3k',
    category: 'xlong_topical',
    description: 'Extra-long topical (~3000 chars, ~550 tokens): full session transcript discussing recall/memory system design. Target: recall_v2_plan (the plan itself).',
    query_tokens: 550,
    exactRows: [
      // FTS OR hits basically everything
      exactRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('project://nocturne_openclaw_integration', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/search_and_extract_routing', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/cli_and_opencode_conventions', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://agent/openclaw/workspace_directory_structure', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('core://agent/docker_image_architecture_check', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://agent/github_push_transport', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('core://soul', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('core://docker_hub_login', 0.78, 2, { glossary_fts_hit: true }),
      exactRow('preferences://user', 0.78, 0, { glossary_fts_hit: true }),
      exactRow('preferences://channels', 0.78, 1, { glossary_fts_hit: true }),
      exactRow('project://subtitle_automation', 0.78, 1, { glossary_fts_hit: true }),
    ],
    glossarySemanticRows: [
      // target dominates GS because its glossary is recall-focused
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.612, 'recall_events', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.598, 'multi-view recall', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.589, 'benchmark framework', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.572, 'recall debug api', 2),
      gsRow('project://nocturne_openclaw_integration', 0.565, 'recall_events', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.554, 'glossary semantic layer', 2),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.543, 'drilldown landed', 2),
      gsRow('project://nocturne_openclaw_integration', 0.523, 'recall debug fixed', 1),
      gsRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.512, 'sensitivity analysis fixed', 2),
      gsRow('project://nocturne_openclaw_integration', 0.498, 'recall usage api', 1),
      gsRow('core://agent', 0.425, 'backups', 1),
      gsRow('core://agent/openclaw/cli_and_opencode_conventions', 0.412, 'openclaw CLI', 2),
    ],
    denseRows: [
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.645, 'gist', 2),
      denseRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.672, 'question', 2),
      denseRow('project://nocturne_openclaw_integration', 0.589, 'gist', 1),
      denseRow('project://nocturne_openclaw_integration', 0.567, 'question', 1),
      denseRow('core://agent', 0.489, 'gist', 1),
      denseRow('core://agent', 0.476, 'question', 1),
      denseRow('core://agent/openclaw/search_and_extract_routing', 0.456, 'gist', 1),
      denseRow('core://agent/openclaw/cli_and_opencode_conventions', 0.432, 'gist', 2),
      denseRow('core://soul', 0.412, 'gist', 0),
      denseRow('preferences://user', 0.398, 'gist', 0),
      denseRow('preferences://channels', 0.387, 'question', 1),
      denseRow('core://agent/openclaw/workspace_directory_structure', 0.376, 'gist', 1),
    ],
    lexicalRows: [
      // 550 tokens: ALL nodes get very high lex scores
      lexicalRow('core://agent', 0.956, 'gist', 1, { fts_hit: true }),
      lexicalRow('project://codex_console_registration', 0.941, 'gist', 3, { fts_hit: true }),
      lexicalRow('project://daily_hackernews_summary_imessage', 0.923, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://gpt_account_automation', 0.912, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/openclaw/cli_and_opencode_conventions', 0.898, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://temp_mail_services', 0.884, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/docker_image_architecture_check', 0.871, 'gist', 2, { fts_hit: true }),
      lexicalRow('core://agent/github_push_transport', 0.856, 'gist', 2, { fts_hit: true }),
      lexicalRow('project://codex_remote_registrar', 0.842, 'gist', 3, { fts_hit: true }),
      lexicalRow('preferences://channels/wechat_channel', 0.829, 'gist', 1, { fts_hit: true }),
      // target in question view, lower rank
      lexicalRow('project://nocturne_openclaw_integration/recall_v2_plan', 0.789, 'question', 2, { fts_hit: true }),
      lexicalRow('project://nocturne_openclaw_integration', 0.745, 'question', 1, { fts_hit: true }),
    ],
    expected: {
      relevant_uris: ['project://nocturne_openclaw_integration/recall_v2_plan', 'project://nocturne_openclaw_integration'],
      top1: 'project://nocturne_openclaw_integration/recall_v2_plan',
      expected_max_top_score: 0.85,
    },
  },
];
