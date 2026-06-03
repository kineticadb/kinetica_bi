export const kpi = [
  { label: "Active Dashboards", value: 42, delta: 8 },
  { label: "Avg Query Latency (ms)", value: 112, delta: -12 },
  { label: "GPU Utilization (%)", value: 76, delta: 3 },
  { label: "Data Ingest (GB/hr)", value: 58, delta: 11 }
];

export const throughput = [
  { name: "Mon", records: 12, latency: 140 },
  { name: "Tue", records: 18, latency: 110 },
  { name: "Wed", records: 22, latency: 118 },
  { name: "Thu", records: 20, latency: 104 },
  { name: "Fri", records: 17, latency: 122 },
  { name: "Sat", records: 10, latency: 160 },
  { name: "Sun", records: 9, latency: 170 }
];

export const datasetUsage = [
  { name: "Telematics", value: 32 },
  { name: "Fraud", value: 21 },
  { name: "Logistics", value: 18 },
  { name: "Retail", value: 14 },
  { name: "Ad Tech", value: 9 },
  { name: "Other", value: 6 }
];

export const latencyDistribution = [
  { bucket: "<50ms", count: 8 },
  { bucket: "50-100ms", count: 18 },
  { bucket: "100-150ms", count: 28 },
  { bucket: "150-200ms", count: 22 },
  { bucket: "200ms+", count: 12 }
];

export const recentActivity = [
  { name: "Fleet Health", owner: "Mia H.", queries: 214, sla: "99.95%" },
  { name: "Fraud Anomalies", owner: "Sana K.", queries: 187, sla: "99.9%" },
  { name: "Store Ops", owner: "Devon R.", queries: 142, sla: "99.5%" },
  { name: "Network Edges", owner: "Alex P.", queries: 121, sla: "99.9%" }
];
