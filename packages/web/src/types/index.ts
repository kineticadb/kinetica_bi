export type KPIMetric = {
  label: string;
  value: number;
  delta: number;
};

export type ActivityRow = {
  name: string;
  owner: string;
  queries: number;
  sla: string;
};
