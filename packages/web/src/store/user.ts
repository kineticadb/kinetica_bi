import { create } from "zustand";

type User = {
  name: string;
  initials: string;
  role: string;
};

type UserState = {
  user: User;
  setName: (name: string) => void;
};

export const useUserStore = create<UserState>((set) => ({
  user: { name: "Data Engineer", initials: "DE", role: "Admin" },
  setName: (name) =>
    set((state) => ({
      user: { ...state.user, name, initials: name.slice(0, 2).toUpperCase() }
    }))
}));
