'use client';

import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Lang = 'zh' | 'en';

type TranslationKey = string;

const DICT: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    // ── nav
    'Memory': '记忆',
    'Recall': '召回',
    'Drilldown': '下钻',
    'Cleanup': '清理',
    'Dream': '梦境',
    'Settings': '设置',

    // ── common
    'Run': '运行',
    'Running…': '运行中…',
    'Save': '保存',
    'Saving…': '保存中…',
    'Cancel': '取消',
    'Edit': '编辑',
    'Delete': '删除',
    'Refresh': '刷新',
    'Loading…': '加载中…',
    'Reset': '重置',
    'Apply': '应用',
    'Close': '关闭',
    'Open': '打开',
    'Back': '返回',
    'Status': '状态',
    'Summary': '摘要',
    'Not found': '未找到',
    'View': '视图',
    'Connecting…': '连接中…',
    'Continue': '继续',
    'Try Again': '重试',
    'Unable to connect': '连接失败',
    'Check that the backend service is running.': '请确认后端服务已启动。',

    // ── auth
    'Memory management console': '记忆管理控制台',
    'Lore memory console': 'Lore 记忆控制台',
    'API Token': 'API 令牌',
    'Enter your token': '输入您的令牌',
    'Invalid token': '令牌无效',
    'Connection failed': '连接失败',

    // ── recall workbench
    'Workbench': '工作台',
    'Inspect every stage of the retrieval pipeline — from raw path hits through merged ranking to prompt injection.':
      '检视召回管线的每一层 —— 从路径命中到融合排序，再到注入 prompt。',
    'Ask the archive…': '向档案发问…',
    'Exclude boot': '排除 boot',
    'More options': '更多选项',
    'Hide options': '收起选项',
    'Session': '会话',
    'Limit': '上限',
    'Min score': '最小分',
    'Max shown': '最多展示',
    'Threshold': '展示阈值',
    'Precision': '精度',
    'Read mode': '读取模式',
    'Runtime': '运行时',
    'Configuration at time of query': '查询时的实时配置',
    'Services': '服务',
    'Weights': '权重',
    'Run a query to inspect each stage of retrieval.': '运行一次查询以检视召回各阶段。',
    'Scoring strategy': '评分策略',
    'Services & strategy': '服务与策略',
    'Strategy': '策略',
    'Query tokens': '查询 token 数',
    'Embedding': '嵌入模型',
    'View LLM': '视图 LLM',
    'Boot URIs': '启动 URI 数',

    // ── recall stages
    'Withheld': '未展示',
    'Exact': '精确',
    'Semantic': '语义',
    'Lexical': '词法',
    'Merged': '融合',
    'Candidate': '候选',
    'Final': '最终分',
    'Breakdown': '分解',
    'Quoted': '引用',
    'Raw': '原始分',
    'Weight': '权重',
    'Weighted': '加权',
    'Cues': '线索',
    'Exact sources': '精确来源',
    'Glossary sources': '术语来源',
    'Semantic sources': '语义来源',
    'Lexical sources': '词法来源',
    'No matching source records.': '无匹配来源记录。',
    'No data yet.': '暂无数据。',
    'No exact hits.': '无精确命中。',
    'No glossary hits.': '无术语命中。',
    'No semantic hits.': '无语义命中。',
    'No lexical hits.': '无词法命中。',
    'No merged candidates.': '无融合候选。',
    'Nothing to show.': '无展示内容。',
    'hits': '命中',
    'candidates': '候选',
    'Suppressed': '抑制',
    'Recall block · prompt injection': '召回注入块',

    // ── drilldown
    'Analytics': '分析',
    'Events': '事件',
    'Shown': '展示',
    'Queries': '查询',
    'Used': '采用',
    'Days': '天数',
    'days': '天',
    'Query text': '查询文本',
    'Node URI': '节点 URI',
    'Fragment…': '片段…',
    'uri…': 'uri…',
    'Hide filters': '收起筛选',
    'Show filters': '展开筛选',
    'Reset filters': '重置筛选',
    'Hide appendix': '收起附录',
    'Show appendix': '展开附录',
    'Recent queries': '最近查询',
    'No queries recorded yet.': '尚无查询记录。',
    'Query': '查询',
    'When': '时间',
    'Entry': '条目',
    'Path': '路径',
    'Score': '分数',
    'Avg': '均值',
    'Source': '来源',
    'All sources': '全部来源',
    'Previous': '上一页',
    'Next': '下一页',
    'Showing range': '显示',
    'of': '共',
    'Failed to load': '加载失败',
    'No path statistics.': '暂无路径统计。',
    'No view statistics.': '暂无视图统计。',
    'No noisy nodes.': '暂无噪声节点。',
    'No queries for this node.': '该节点暂无查询。',
    'No events yet.': '暂无事件。',
    'By path': '按路径',
    'By view': '按视图',
    'Noisy nodes': '噪声节点',
    'Raw events': '原始事件',

    // ── memory
    'Archive': '档案',
    'Domains': '域',
    'Current': '当前',
    'Disclosure: ': '披露：',
    'Also:': '别名：',
    'Return to root': '返回根目录',
    'This folder is empty.': '此目录为空。',
    'Clusters': '聚类',
    'Children': '子项',
    'Empty': '空',
    'Editing': '编辑中',
    'Priority': '优先级',
    'Disclosure': '披露',
    'When should this memory be recalled?': '何时召回这条记忆？',
    'Glossary': '术语',
    'keyword': '关键词',
    'Add': '添加',
    'Switch to light': '切换到亮色',
    'Switch to dark': '切换到暗色',
    'Tree': '目录',
    'Hide tree': '收起目录',
    'Agent memory graph': '代理记忆图谱',
    'Retrieval views': '检索视图',

    // ── maintenance
    'Deprecated': '已废弃',
    'Orphaned': '孤立',
    'Orphans': '孤立记忆',
    'Memories that no longer connect to the active graph. Review and remove what is safe to drop.':
      '不再挂在图里的记忆。审核后可移除。',
    'Scanning…': '扫描中…',
    'Rescan': '重新扫描',
    'Deleting…': '删除中…',
    'All clear. No orphans to review.': '一切清爽，暂无孤立项。',
    'migrated to': '迁移至',
    'Diff': '差异',
    'Full text': '全文',
    'Delete {n} memories?': '确认删除所选 {n} 条记忆？',

    // ── dream
    'Structural Audit': '结构审计',
    'Dream Diary': '梦境日记',
    'Memory Maintenance': '记忆整理',
    'Dream audits Lore structure — path placement, split needs, retrieval-path issues, and safe move/update decisions.':
      'Dream 会检查 Lore 的结构，判断节点该放在哪里、是否需要拆分，以及哪些调整适合安全执行。',
    'System dreams daily to organize memories — index refresh, health checks, and LLM-driven consolidation.':
      '系统每天自动整理记忆——刷新索引、检查健康状况，并用模型辅助归纳整合。',
    'Run started': '运行开始',
    'Phase started': '阶段开始',
    'Phase completed': '阶段完成',
    'LLM turn': '模型回合',
    'Tool started': '工具开始',
    'Tool finished': '工具完成',
    'Assistant note': '模型备注',
    'Run completed': '运行完成',
    'Run failed': '运行失败',
    'Index refresh': '索引刷新',
    'Data collection': '数据收集',
    'Agent loop': '执行循环',
    'Path recs': '路径建议',
    'Run Dream Now': '立即运行',
    'Dreaming…': '运行中…',
    'Last Dream': '最近一次',
    'Total Entries': '总条目',
    'Last Status': '上次状态',
    'Schedule': '定时计划',
    'Off': '关闭',
    'completed': '完成',
    'error': '错误',
    'running': '运行中',
    'Narrative': '日记',
    'Tool Calls': '工具调用',
    'Health Report': '健康报告',
    'healthy': '健康',
    'underperforming': '低效',
    'dead': '沉睡',
    'noisy': '噪声',
    'Rollback': '回滚',
    'Rolling back…': '回滚中…',
    'rolled_back': '已回滚',
    'Confirm rollback? This will reverse all changes from this dream.': '确认回滚？这将撤销此次梦境整理的所有修改。',
    'Viewed': '查看',
    'Modified': '修改',
    'Created': '新增',
    'Deleted': '删除',
    'Date': '日期',
    'Duration': '耗时',
    'No diary entries yet. Run your first dream!': '暂无日记。立即运行一次。',
    'calls': '次调用',
    'dead writes': '无效写入',
    'Memory Changes': '记忆变更',
    'Agent Workflow': '执行过程',
    'Waiting for workflow events…': '等待执行过程事件…',
    'Moved': '已移动',
    'Protected': '保护拦截',
    'Protected boot block': '固定启动节点拦截',
    'create': '新增',
    'update': '更新',
    'delete': '删除',
    'move': '移动',
    'alias': '别名',
    'glossary_add': '术语新增',
    'glossary_remove': '术语移除',
    'No changes': '无变更',
    'Before': '修改前',
    'After': '修改后',

    // ── backup
    'Backup Actions': '备份操作',
    'Manual backup and restore operations': '手动备份与恢复操作',
    'Last backup': '上次备份',
    'Run Backup Now': '立即备份',
    'Backing up…': '备份中…',
    'Export & Download': '导出下载',
    'Exporting…': '导出中…',
    'Export completed': '导出完成',
    'Import & Restore': '导入恢复',
    'Restoring…': '恢复中…',
    'Backup completed': '备份完成',
    'Restore completed': '恢复完成',
    'Confirm restore? This will replace ALL current data.': '确认恢复？这将替换所有当前数据。',
    'Size': '大小',

    // ── settings
    'Default': '默认',
    'From env': '环境变量',
    'Unsaved': '未保存',
    'Configuration': '配置',
    'Runtime parameters for the recall pipeline. Changes take effect immediately.':
      '召回管线的运行时参数，修改立即生效。',
    'Discard': '丢弃',
  },
  en: {}, // English uses keys verbatim
};

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (k: string) => k,
});

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' && window.localStorage.getItem('lore-lang');
      if (saved === 'zh' || saved === 'en') setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem('lore-lang', next); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    if (lang === 'en') return key;
    return DICT.zh[key] ?? key;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT(): LanguageContextValue {
  return useContext(LanguageContext);
}
