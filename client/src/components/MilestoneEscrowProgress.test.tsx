import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MilestoneEscrowProgress from "./MilestoneEscrowProgress";

describe("MilestoneEscrowProgress", () => {
  it("renders not-started state with zero progress", () => {
    render(<MilestoneEscrowProgress currentMilestoneIndex={-1} />);

    expect(screen.getByText("Milestone Progress")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.getByText("Awaiting the first production milestone."),
    ).toBeInTheDocument();
  });

  it("highlights planted → growing timeline for index 1", () => {
    render(<MilestoneEscrowProgress currentMilestoneIndex={1} />);

    expect(screen.getByTestId("milestone-current-status")).toHaveTextContent("Growing");
    expect(
      screen.getByText("Crop is actively growing in the field."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("milestone-growing")).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByTestId("milestone-planted")).toHaveAttribute(
      "data-state",
      "past",
    );
  });

  it("shows farmer advance control and calls onAdvance", () => {
    const onAdvance = vi.fn();
    render(
      <MilestoneEscrowProgress
        currentMilestoneIndex={0}
        canAdvance
        onAdvance={onAdvance}
      />,
    );

    const btn = screen.getByRole("button", { name: /Advance to Growing/i });
    fireEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("hides advance for buyer read-only view", () => {
    render(
      <MilestoneEscrowProgress currentMilestoneIndex={2} canAdvance={false} />,
    );

    expect(
      screen.queryByRole("button", { name: /Advance/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/farmer advances milestones/i),
    ).toBeInTheDocument();
  });

  it("shows complete state at delivered", () => {
    render(<MilestoneEscrowProgress currentMilestoneIndex={4} canAdvance />);

    expect(screen.getByTestId("milestone-current-status")).toHaveTextContent("Delivered");
    expect(
      screen.queryByRole("button", { name: /Advance/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders unavailable fallback", () => {
    render(<MilestoneEscrowProgress unavailable />);

    expect(
      screen.getByText(/not available for this order/i),
    ).toBeInTheDocument();
  });
});
