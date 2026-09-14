"use server";

import { requireSession } from "@/lib/auth";
import { searchClientSuggestions, type ClientSuggestion } from "@/lib/clients";

export async function searchClientsAction(query: string): Promise<ClientSuggestion[]> {
  await requireSession();
  if (!query || query.trim().length < 1) return [];
  return searchClientSuggestions(query);
}
