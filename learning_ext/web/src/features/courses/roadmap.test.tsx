import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoadmapExplorer } from "./RoadmapExplorer";
import { makeRoadmap } from "../../test/factories";

void React;

describe("RoadmapExplorer", () => {
  let observerCallback: IntersectionObserverCallback | undefined;
  beforeEach(() => {
    observerCallback = undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
      observe() { return undefined; }
      disconnect() { return undefined; }
      unobserve() { return undefined; }
    });
  });

  it("mounts all 50 headings and outline entries without flattening the page", () => {
    const { container } = render(<RoadmapExplorer roadmap={makeRoadmap()} initialNodeId="node-1" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(50);
    expect(container.querySelectorAll(".roadmap-outline .outline-node")).toHaveLength(50);
    expect(container.querySelectorAll(".roadmap-content > .roadmap-node")).toHaveLength(50);
    expect(container.querySelectorAll('.roadmap-node-detail[hidden]')).toHaveLength(49);
    expect(container.querySelector(".roadmap-content")).toHaveClass("roadmap-content");
  });

  it("opens and locates a directory target with a stable node id", async () => {
    const { container } = render(<RoadmapExplorer roadmap={makeRoadmap()} initialNodeId="node-1" />);
    const outline = container.querySelector('.roadmap-outline [data-node-id="node-50"]') as HTMLElement;
    fireEvent.click(outline);
    await waitFor(() => expect(container.querySelector('.roadmap-content [data-node-id="node-50"] .roadmap-node-detail')).not.toHaveAttribute("hidden"));
    expect(outline).toHaveAttribute("aria-current", "location");
    const middle = container.querySelector('.roadmap-content [data-node-id="node-25"]') as HTMLElement;
    act(() => observerCallback?.([{ isIntersecting: true, target: middle, boundingClientRect: { top: 0 } } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(outline).toHaveAttribute("aria-current", "location");
  });

  it("uses the observer to update active navigation and leaves malicious HTML inert", async () => {
    const { container } = render(<RoadmapExplorer roadmap={makeRoadmap()} initialNodeId="node-1" />);
    const target = container.querySelector('.roadmap-content [data-node-id="node-50"]') as HTMLElement;
    act(() => observerCallback?.([{ isIntersecting: true, target, boundingClientRect: { top: 0 } } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(container.querySelector('.roadmap-outline [data-node-id="node-50"]')).toHaveAttribute("aria-current", "location"));
    expect(container.querySelector("script")).toBeNull();
    expect(within(container).queryByText("window.evil = true")).toBeNull();
  });
});
