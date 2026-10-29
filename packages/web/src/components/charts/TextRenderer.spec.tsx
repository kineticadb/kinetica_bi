import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TextRenderer from "./TextRenderer";
import type { WidgetDto } from "../../api/client";

const widget = (config: Record<string, unknown>): WidgetDto => ({
  id: 1, dashboard_id: 1, title: "Notes", type: "text", position: 0, config, created_at: "", updated_at: "",
});

describe("TextRenderer", () => {
  it("TXT-1 renders the widget's markdown as elements, HTML as text", () => {
    const { container } = render(<TextRenderer widget={widget({ markdown: "## Findings\n- Cash tips **more**\n<b>raw</b>" })} />);
    expect(screen.getByTestId("text-widget")).toBeTruthy();
    expect(container.querySelector("h4")?.textContent).toBe("Findings");
    expect(container.querySelector("li strong")?.textContent).toBe("more");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>raw</b>");
  });

  it("TXT-2 empty or missing text shows a hint instead", () => {
    for (const config of [{}, { markdown: "  " }, { markdown: 42 }]) {
      const { unmount } = render(<TextRenderer widget={widget(config)} />);
      expect(screen.getByRole("status").textContent).toContain("No text yet");
      unmount();
    }
  });
});
