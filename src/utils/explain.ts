/**
 * Condenses MongoDB explain("executionStats") output (find or aggregate, classic
 * or SBE engine) into the facts that matter for index review: winning-plan
 * stages, indexes used, and keys/docs examined.
 */

type Json = Record<string, unknown>;

export interface PlanSummary {
  stages: string[];
  indexes: string[];
  nReturned?: number;
  totalKeysExamined?: number;
  totalDocsExamined?: number;
}

export interface ExplainSummary extends PlanSummary {
  pipeline?: Array<{ stage: string } & Partial<PlanSummary> & Json>;
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

function collectPlan(node: unknown, stages: string[], indexes: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectPlan(child, stages, indexes));
    return;
  }
  if (!isObject(node)) return;
  if (typeof node.stage === "string") stages.push(node.stage);
  // IDHACK is the planner's fast path for an exact _id match on the built-in index.
  const indexName = node.stage === "IDHACK" ? "_id_" : node.indexName;
  if (typeof indexName === "string" && !indexes.includes(indexName)) indexes.push(indexName);
  for (const key of ["queryPlan", "inputStage", "inputStages", "outerStage", "innerStage"]) {
    if (key in node) collectPlan(node[key], stages, indexes);
  }
}

function summarizeQuery(explain: Json): PlanSummary {
  const stages: string[] = [];
  const indexes: string[] = [];
  const planner = explain.queryPlanner;
  if (isObject(planner)) collectPlan(planner.winningPlan, stages, indexes);
  const stats = isObject(explain.executionStats) ? explain.executionStats : {};
  return {
    stages,
    indexes,
    nReturned: stats.nReturned as number | undefined,
    totalKeysExamined: stats.totalKeysExamined as number | undefined,
    totalDocsExamined: stats.totalDocsExamined as number | undefined,
  };
}

export function summarizeExplain(explain: unknown): ExplainSummary {
  if (!isObject(explain)) return { stages: [], indexes: [] };
  // Mongoose returns an array for aggregate explains on some versions.
  const root = Array.isArray(explain) ? (explain[0] as Json) : explain;

  // Aggregations that are not fully pushed down report one entry per stage.
  if (Array.isArray(root.stages)) {
    const pipeline = (root.stages as Json[]).map((entry) => {
      const stage = Object.keys(entry).find((key) => key.startsWith("$")) ?? "unknown";
      if (stage === "$cursor") return { stage, ...summarizeQuery(entry.$cursor as Json) };
      const extra: Json = {};
      for (const key of ["nReturned", "totalDocsExamined", "totalKeysExamined", "collectionScans", "indexesUsed"]) {
        if (key in entry) extra[key] = entry[key];
      }
      return { stage, ...extra };
    });
    const cursor = pipeline.find((entry) => entry.stage === "$cursor") as (PlanSummary & { stage: string }) | undefined;
    return {
      stages: cursor?.stages ?? [],
      indexes: cursor?.indexes ?? [],
      nReturned: cursor?.nReturned,
      totalKeysExamined: cursor?.totalKeysExamined,
      totalDocsExamined: cursor?.totalDocsExamined,
      pipeline,
    };
  }

  return summarizeQuery(root);
}
