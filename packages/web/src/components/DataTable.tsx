import { ActivityRow } from "../types";

type Props = {
  rows: ActivityRow[];
};

const DataTable = ({ rows }: Props) => (
  <table className="data-table">
    <thead>
      <tr>
        <th>Dashboard</th>
        <th>Owner</th>
        <th>Queries (24h)</th>
        <th>SLA</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.name}>
          <td>{row.name}</td>
          <td>{row.owner}</td>
          <td>{row.queries.toLocaleString()}</td>
          <td>{row.sla}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default DataTable;
