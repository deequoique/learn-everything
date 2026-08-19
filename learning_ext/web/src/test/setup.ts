import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

afterEach(() => cleanup());

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });
  HTMLElement.prototype.scrollIntoView = (() => undefined) as typeof HTMLElement.prototype.scrollIntoView;
  Element.prototype.scrollTo = (() => undefined) as typeof Element.prototype.scrollTo;
});
