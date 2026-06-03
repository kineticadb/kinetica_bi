// Zustand store-reset shim per official testing guide:
// https://github.com/pmndrs/zustand/blob/HEAD/docs/learn/guides/testing.md
// Activated via `vi.mock("zustand")` in src/test/setup.ts.

import { afterEach, vi } from "vitest";
import { act } from "@testing-library/react";
import * as zustandActual from "zustand";

const { create: actualCreate, createStore: actualCreateStore } =
  await vi.importActual<typeof zustandActual>("zustand");

const storeResetFns = new Set<() => void>();

const createUncurried = <T>(stateCreator: zustandActual.StateCreator<T>) => {
  const store = actualCreate(stateCreator);
  const initialState = store.getState();
  storeResetFns.add(() => store.setState(initialState, true));
  return store;
};

export const create = (<T>(stateCreator?: zustandActual.StateCreator<T>) =>
  stateCreator ? createUncurried(stateCreator) : createUncurried) as typeof zustandActual.create;

export const createStore = ((stateCreator: zustandActual.StateCreator<unknown>) => {
  const store = actualCreateStore(stateCreator);
  const initialState = store.getState();
  storeResetFns.add(() => store.setState(initialState, true));
  return store;
}) as typeof zustandActual.createStore;

afterEach(() => {
  act(() => {
    storeResetFns.forEach((fn) => fn());
  });
});
