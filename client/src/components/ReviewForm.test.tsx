import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReviewForm from "./ReviewForm";

describe("ReviewForm", () => {
  it("requires verified review details before submitting", async () => {
    const onSubmit = vi.fn();

    render(
      <ReviewForm
        reviewerName="Amina S."
        reviewerRole="buyer"
        reviewerWallet="GTEST"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Review title"), {
      target: { value: "Good" },
    });
    fireEvent.change(screen.getByLabelText("Written review"), {
      target: { value: "Great product and timely delivery." },
    });
    fireEvent.change(screen.getByLabelText("Transaction hash"), {
      target: { value: "TX-123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("1 star"));
    fireEvent.change(screen.getByLabelText("Transaction hash"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText(/Add a title, a detailed review/i)).toBeInTheDocument();
  });
});
