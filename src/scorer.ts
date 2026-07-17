export interface RiskScore {
  complexity: number;
  risk: number;
  uncertainty: number;
  multiView: number;
  committeeScore: number;
  tier: "C0" | "C1" | "C2" | "C3";
  taskType: string;
  hasTools: boolean;
}

const HIGH_RISK = [
  "诊断","处方","用药","剂量","症状","医疗","健康","疾病",
  "diagnosis","prescription","dosage","symptom","medical","disease",
  "合同","法律","诉讼","条款","合规","知识产权","专利",
  "legal","contract","lawsuit","compliance","patent","liability",
  "投资","理财","税务","审计","财报","估值","风险投资",
  "investment","tax","audit","financial","valuation","portfolio",
  "架构设计","系统设计","数据库迁移","安全设计","权限设计",
  "architecture","system design","migration","security design",
];

const MULTI_VIEW = [
  "比较","对比","选择","方案","最佳","最优","战略","权衡",
  "利弊","优缺点","是否应该","还是","alternatives","compare",
  "versus","vs","trade-off","tradeoff","pros and cons",
  "best approach","recommend","should i",
];

const AMBIGUITY = [
  "可能","也许","大概","不确定","不清楚","取决于",
  "maybe","perhaps","might","unclear","depends","not sure",
];

const CODE = [
  "```","def ","function ","class ","import ","const ","let ",
  "var ","public ","private ","SELECT ","INSERT ","CREATE TABLE",
  "async ","await ","return ","if ","for ","while ",
  "算法","排序","复杂度","架构","设计","分析","比较",
];

export function score(inputText: string, hasTools = false): RiskScore {
  const lower = inputText.toLowerCase();
  const len = inputText.length;

  const codeHits = CODE.filter((c) => lower.includes(c.toLowerCase())).length;
  const complexity = Math.min((Math.min(len / 5000, 1) * 0.4 + Math.min(codeHits / 5, 1) * 0.6), 1);

  const riskHits = HIGH_RISK.filter((kw) => lower.includes(kw.toLowerCase())).length;
  const risk = Math.min(riskHits / 3, 1);

  const ambigHits = AMBIGUITY.filter((kw) => lower.includes(kw.toLowerCase())).length;
  const uncertainty = Math.min(ambigHits / 3, 1);

  const mvHits = MULTI_VIEW.filter((kw) => lower.includes(kw.toLowerCase())).length;
  const multiView = Math.min(mvHits / 2, 1);

  let committeeScore = complexity * 0.2 + risk * 0.35 + uncertainty * 0.25 + multiView * 0.2;
  if (hasTools) committeeScore = 0;

  const tier = classifyTier(complexity, risk);
  const taskType = classifyTask(lower);

  return { complexity, risk, uncertainty, multiView, committeeScore, tier, taskType, hasTools };
}

function classifyTier(complexity: number, risk: number): RiskScore["tier"] {
  if (risk > 0.3) return "C3";
  if (complexity > 0.5) return risk < 0.2 ? "C2" : "C3";
  if (complexity > 0.2) return "C1";
  return "C0";
}

function classifyTask(text: string): string {
  const checks: [string[], string][] = [
    [["```","def ","function ","sql","code","bug","代码","编程"], "coding"],
    [["翻译","translate","润色","polish"], "translation"],
    [["总结","摘要","summarize","summarise"], "summarization"],
    [["架构","设计","architecture","design","系统设计"], "architecture"],
    [["分析","研究","analyze","research","调研"], "research"],
    [["写","创作","文章","write","essay","story"], "writing"],
    [["数学","计算","math","calculate","方程"], "math"],
    [["法律","合同","legal","contract"], "legal"],
    [["医疗","诊断","medical","diagnosis"], "medical"],
  ];
  for (const [kws, type] of checks) {
    if (kws.some((kw) => text.includes(kw))) return type;
  }
  return "general";
}

export function extractUserInput(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const c = messages[i].content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ");
      }
    }
  }
  return "";
}

export function isBorderline(score: RiskScore): boolean {
  return score.committeeScore > 0.3 && score.committeeScore < 0.7;
}
