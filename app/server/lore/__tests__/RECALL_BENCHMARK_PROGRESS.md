# Recall Strategy Optimization — 进度与报告

## 当前进度

### 已完成
- [x] 完整分析现有 recall 系统架构和评分公式
- [x] 从 `recall.js` 导出 `aggregateCandidates` 和 `RECALL_RANKING` 供测试使用
- [x] 实现 5 种替代排序策略 (`recall-strategies.js`)
- [x] **用生产真实数据重建测试集** — 28 个真实节点 + 15 个查询（从 recall/debug API 获取）
- [x] 手动标注 ground truth（18 个测试场景，7 个类别）
- [x] **修复 Sensitivity analysis 排序固化问题** — 改用 `collectCandidates` 获取原始分数
- [x] **完成 benchmark 对比报告**

### 待完成
- [ ] **实施 recall 策略改造** — 将 Weighted RRF 集成到 `recall.js`
- [ ] 线上 A/B 验证

## Benchmark 结果（生产数据）

### 策略排名

| 排名 | 策略 | 参数 | R@1 | R@3 | MRR | Top1 | Composite |
|------|------|------|-----|-----|-----|------|-----------|
| 1 | **D-WeightedRRF** | k20_balanced | **0.833** | **1.000** | **1.000** | **1.000** | **1.000** |
| 2 | D-WeightedRRF | balanced | 0.833 | 1.000 | 1.000 | 1.000 | 0.999 |
| 3 | C-RRF | k20 | 0.833 | 1.000 | 1.000 | 1.000 | 0.998 |
| ... | ... | ... | ... | ... | ... | ... | ... |
| 18 | **A-Current** | original | 0.741 | 0.944 | 0.972 | 0.889 | **0.942** |

**最优策略 D-WeightedRRF (k=20) 相比现有系统提升 +5.8%**

### 现有系统最弱类别

| 类别 | A-Current | D-WeightedRRF | 差距 |
|------|-----------|---------------|------|
| **gs_threshold** | 0.689 | 1.000 | **+31.1%** |
| **semantic** | 0.893 | 1.000 | +10.7% |
| exact_identity | 1.000 | 1.000 | 0% |

### Sensitivity Analysis（调参效果）

| 变体 | Composite | 提升 |
|------|-----------|------|
| original | 0.942 | - |
| higher_lexical_cap | 0.942 | 0% |
| lower_gs_threshold | 0.942 | 0% |
| higher_priority | **0.953** | +1.1% |
| balanced_signals | 0.942 | 0% |
| semantic_dominant | 0.942 | 0% |

**结论：在线性加法架构下调参几乎无效，问题在架构层面。**

## 现有系统问题诊断

### 评分公式
```javascript
RECALL_RANKING = {
  exact_multiplier: 0.56, exact_cap: 0.56,        // cap == multiplier，cap 无效
  glossary_semantic_min_score: 0.88,               // 阈值太高
  glossary_semantic_multiplier: 0.5, glossary_semantic_cap: 0.5,
  semantic_multiplier: 0.78,                       // 语义主导，无 cap
  lexical_multiplier: 0.22, lexical_cap: 0.14,     // lexical 被压制
  priority_base: 0.05, priority_step: 0.01,        // priority 影响太小
};
```

### 核心问题
1. **GS 阈值 0.88 太高** — 生产数据中大量查询（"部署nocturne" GS=0.788, "recall优化" GS=0.729, "记忆整理备份" GS=0.607）的 glossary 信号被完全丢弃
2. **线性加法无法表达交叉增强** — exact + GS 双确认无法产生额外增益
3. **分数尺度不一致** — exact 0.84-0.98 vs dense 0.2-0.65 vs lexical 0.0-0.15，乘以不同 multiplier 后仍然不可比
4. **Lexical cap 0.14** — 即使完美 FTS 匹配（0.155）也被截断

### 为什么 Weighted RRF 更优
- **排名融合而非分数融合** — 完全规避尺度不一致问题
- **无 threshold 门槛** — 只要在某路径中排名靠前就有贡献
- **加权体现路径可信度** — exact (1.5) > GS (1.2) > dense (1.0) > lexical (0.8)
- **k=20 比 k=60 更激进** — 排名靠前的候选者获得更高倍率

## 推荐方案

**将 `recall.js` 的 `aggregateCandidates` 改为 Weighted RRF 策略。**

推荐参数：
```javascript
{
  k: 20,
  w_exact: 1.5,
  w_glossary_semantic: 1.2,
  w_dense: 1.0,
  w_lexical: 0.8,
  priority_weight: 0.03,
}
```

改造范围：
- `recall.js` 中的 `aggregateCandidates` 函数
- 保持 API 返回格式不变
- 保持 `RECALL_RANKING` 常量用于向后兼容（但不再用于排序）

## 文件结构

```
app/server/nocturne/
├── recall.js                          # 待改造：aggregateCandidates → Weighted RRF
├── __tests__/
│   ├── recall-benchmark.test.js       # Benchmark runner + metrics + strategy comparison
│   ├── recall-strategies.js           # 5 种替代排序策略实现 (B-F)
│   ├── recall-test-data.js            # 18 个生产数据测试场景
│   └── RECALL_BENCHMARK_PROGRESS.md   # 本文件
```

## 运行方法

```bash
cd web
npx vitest run server/nocturne/__tests__/recall-benchmark.test.js --reporter=verbose
```
