import { KPIMetric } from "../types";

type Props = {
  data: KPIMetric[];
};

const format = (value: number, label: string) => {
  if (label.includes("%")) return `${value}%`;
  if (label.toLowerCase().includes("latency")) return value.toString();
  return value.toLocaleString();
};

const KPIGrid = ({ data }: Props) => (
  <div className="kpi-grid">
    {data.map((item) => (
      <div key={item.label} className="kpi-card">
        <div className="kpi-label">{item.label}</div>
        <div className="kpi-value">{format(item.value, item.label)}</div>
        <div className={`kpi-delta ${item.delta >= 0 ? "up" : "down"}`}>
          {item.delta >= 0 ? "▲" : "▼"} {Math.abs(item.delta)}%
        </div>
      </div>
    ))}
  </div>
);

export default KPIGrid;
