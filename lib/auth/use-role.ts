"use client";

import { useMemo } from "react";
import { authClient } from "@/lib/auth/client";

export type AppRole = "admin" | "user";

export interface AuthRoleUser {
  id: string;
  email: string;
  name: string;
  username?: string | null;
  role: AppRole;
}

export interface UseAuthRoleResult {
  user: AuthRoleUser | null;
  role: AppRole | null;
  isAdmin: boolean;
  isCitizen: boolean;
  isAuthenticated: boolean;
  isPending: boolean;
}

export function useAuthRole(): UseAuthRoleResult {
  const { data: session, isPending } = authClient.useSession();

  return useMemo(() => {
    const rawUser = session?.user as
      | {
          id: string;
          email: string;
          name: string;
          username?: string | null;
          role?: string | null;
        }
      | undefined;

    if (!rawUser) {
      return {
        user: null,
        role: null,
        isAdmin: false,
        isCitizen: false,
        isAuthenticated: false,
        isPending,
      };
    }

    const role: AppRole = rawUser.role === "admin" ? "admin" : "user";

    return {
      user: {
        id: rawUser.id,
        email: rawUser.email,
        name: rawUser.name,
        username: rawUser.username ?? null,
        role,
      },
      role,
      isAdmin: role === "admin",
      isCitizen: role === "user",
      isAuthenticated: true,
      isPending,
    };
  }, [session, isPending]);
}
