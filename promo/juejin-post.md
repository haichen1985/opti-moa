# 我用 1500 行 TypeScript 写了一个 LLM 智能路由代理，省钱 60%+

> 开源项目 OptiMoa：OpenAI 兼容代理，智能路由 + 多模型委员会 + 经验学习，让每一分钱花在刀刃上。

## 痛点

你有没有遇到过这种情况：

- 用 GPT-4o 回答"你好"——花了 $0.01，回答和 $0.001 的模型一样
- 用便宜模型回答架构设计问题——答案漏洞百出，还得手动重问
- 同一个问题反复问，每次都重新消耗 token

**核心矛盾：不是所有问题都需要最强模型，但你不知道该用哪个。**

## 解决方案：OptiMoa

OptiMoa 是一个 OpenAI 兼容的 LLM API 代理。你不需要改任何代码，只需要把 `base_url` 指向它，它就会：

1. **自动评分**：分析你的问题复杂度、风险等级
2. **智能路由**：简单问题走便宜模型，复杂问题走强模型
3. **质量保障**：高风险问题自动开多模型委员会
4. **持续学习**：记录每次决策质量，越用越聪明

```
你的 Agent → OptiMoa → 便宜模型（简单问题）
                     → 中端模型（中等问题）
                     → 强模型（复杂问题）
                     → 3模型委员会（高风险问题）
```

## 核心架构

### 1. 风险评分引擎（零 LLM 调用）

纯关键词匹配，<1ms 完成评分：

```typescript
// 四个维度评分
complexity: 代码关键词密度 + 文本长度
risk:       医疗/法律/金融/架构等高风险词
uncertainty: "可能"/"也许"/"不确定"等模糊词
multiView:  "比较"/"权衡"/"最佳方案"等多视角词

// 综合得出 committeeScore，决定是否开委员会
committeeScore = complexity*0.2 + risk*0.35 + uncertainty*0.25 + multiView*0.2
```

### 2. 四级路由

| 层级 | 条件 | 路由到 | 场景 |
|------|------|--------|------|
| C0 | 闲聊 | 最便宜模型 | "你好"、"谢谢" |
| C1 | 简单 | 便宜模型 | "2+2等于几" |
| C2 | 中等 | 中端模型 | "写一个排序算法" |
| C3 | 复杂/高风险 | 强模型 | "设计微服务架构" |

### 3. MOA 委员会（Mixture of Agents）

当 `committeeScore >= 0.7` 时自动触发：

```
用户问题 → 并行调用3个模型 → 聚合器综合 → 最终答案
```

不是每次都开——只在高风险时触发，控制成本。

### 4. Judge 质量判定

边界情况（不确定该用便宜还是贵的）：

1. 先用便宜模型回答
2. Judge 异步评估置信度
3. 置信度低 → 自动升级到委员会
4. **全程异步，用户无感知**

### 5. 经验引擎

每次请求记录到 SQLite：

```sql
task_type | model | committee | success | quality_score | timestamp
coding    | cheap | 0         | 1       | 0.85          | 2026-07-17
coding    | mid   | 0         | 1       | 0.92          | 2026-07-17
```

下次同类任务，自动选历史质量最高的模型。

## 5 分钟接入

### 安装

```bash
npx github:haichen1985/opti-moa
```

### 配置（交互式向导）

```
? 添加你的第一个模型：
  名称: deepseek-cheap
  Base URL: https://api.deepseek.com/v1
  API Key: sk-xxx
  模型: deepseek-chat

? 添加第二个模型（可选）：
  名称: gpt4o
  Base URL: https://api.openai.com/v1
  API Key: sk-xxx
  模型: gpt-4o
```

### 使用

```python
from openai import OpenAI

# 改一行 base_url，其他不变
client = OpenAI(base_url="http://127.0.0.1:8080/v1", api_key="any")

# 简单问题 → 自动路由到便宜模型
resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "What is 2+2?"}]
)

# 复杂问题 → 自动开委员会
resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "设计一个分布式URL短链系统，比较不同存储方案的利弊"}]
)
```

### 兼容的 Agent 框架

- **Cursor**: Settings → Models → Override OpenAI Base URL
- **AutoGen**: `config_list=[{"base_url": "http://127.0.0.1:8080/v1"}]`
- **LangChain**: `OpenAI(base_url="http://127.0.0.1:8080/v1")`
- **CrewAI**: `llm=ChatOpenAI(base_url="http://127.0.0.1:8080/v1")`

## 实际效果

用 3 个模型测试（xiaomi_cheap / stepfun / xiaomi_pro）：

| 指标 | 值 |
|------|-----|
| 简单问题延迟 | 2-5 秒 |
| 委员会延迟 | 45-80 秒 |
| 路由准确率 | ~85%（关键词引擎） |
| 成本节省 | ~60%（简单问题走便宜模型） |

## 技术栈

- **TypeScript** + **Hono**（HTTP 框架）
- **better-sqlite3**（经验引擎 + 记忆存储）
- **js-yaml**（配置管理）
- 总计 ~1500 行代码，零框架依赖

## 已知局限

1. **评分引擎是关键词匹配**，不是 ML。攒够 500 条数据后可以训练 LightGBM 路由器
2. **委员会模式延迟较高**（3 模型并行 + 聚合），适合非实时场景
3. **经验引擎需要积累数据**，前几十次请求效果不明显

## 开源地址

GitHub: https://github.com/haichen1985/opti-moa

MIT 协议，欢迎 Star / Fork / 提 Issue。

---

**如果你也在为 LLM API 成本发愁，试试 OptiMoa。如果有人用，我就继续优化；如果没人用，说明需求不成立，早知道早止损。**
