import { ReactNode } from "react";
import clsx from "clsx";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  dense?: boolean;
};

const ChartCard = ({ title, description, actions, children, dense }: Props) => (
  <section className={clsx("card", dense && "card-dense")}>
    <header className="card-head">
      <div>
        <div className="card-title">{title}</div>
        {description && <div className="card-sub">{description}</div>}
      </div>
      {actions && <div className="card-actions">{actions}</div>}
    </header>
    <div className="card-body">{children}</div>
  </section>
);

export default ChartCard;
